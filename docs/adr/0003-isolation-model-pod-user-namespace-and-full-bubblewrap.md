# 0003. Isolation model: pod user namespace plus full-strength bubblewrap

Date: 2026-10-26
Status: Accepted

## Context

`sandbox-runtime` (srt) isolates a process on Linux with bubblewrap: a fresh mount namespace with
read-only binds for every write deny, a removed network namespace so all traffic must go through
srt's proxies over a bind-mounted Unix socket, a nested user+PID+mount namespace from the
`apply-seccomp` helper that blocks Unix sockets and refuses `unshare`, `mount`, `pivot_root`
and friends, and a fresh `/proc`. That design assumes it runs on a host, not inside a container.

Inside a Kubernetes pod three things get in the way:

1. The container runtime masks parts of `/proc`; the kernel then refuses a new procfs mount in a
   child mount namespace (`bwrap: Can't mount proc on /newroot/proc: Operation not permitted`).
   Upstream's answer is `enableWeakerNestedSandbox`, which bind-mounts the container's `/proc`
   instead and "considerably weakens security".
2. The runtime's default AppArmor profile (`cri-containerd.apparmor.d`) denies `mount`, and a
   `RuntimeDefault` seccomp profile denies `unshare`/`clone` with namespace flags.
3. Root in a normal pod is root on the node. Any escape from bubblewrap would land as uid 0.

Kubernetes 1.36 on this cluster makes a better arrangement possible: pod user namespaces
(`hostUsers: false`) are GA and `procMount: Unmasked` is GA (KEP-4265), both supported by
containerd 2.3 and kernel 6.8 with idmapped mounts on the local ext4 filesystem.

## Decision

Sandbox pods run with:

| Field | Value | Why |
|---|---|---|
| `spec.hostUsers` | `false` | The pod gets its own user namespace; container uid 0 maps to an unprivileged host uid (observed: 2889613312). |
| `container.securityContext.procMount` | `Unmasked` | No overmounts on `/proc`, so bubblewrap can mount a fresh procfs. Only legal together with `hostUsers: false`. |
| `spec.securityContext.appArmorProfile.type` | `Unconfined` | The default profile denies the `mount` calls bubblewrap needs. |
| `spec.securityContext.seccompProfile.type` | `Unconfined` | The runtime default profile denies `unshare` with `CLONE_NEWUSER`. srt applies its own seccomp filter to the sandboxed command. |
| `runAsUser` / `runAsGroup` / `fsGroup` | `1000` (`agent`), `runAsNonRoot: true` | Upstream recommends a non-root caller; the sandboxed command then holds no capabilities at all. |
| `capabilities.drop` | `[ALL]` | A new user namespace grants a full set inside itself regardless of the parent's bounding set, so nothing is lost. |
| `allowPrivilegeEscalation` | `false` | No setuid path is needed; bubblewrap is not installed setuid. |
| `readOnlyRootFilesystem` | `true` | Only `/workspace`, the home volume and `/tmp` are writable (ADR-0008). |
| `privileged` | `false` | Never. |

srt runs in its default **strict** mode inside that pod. `enableWeakerNestedSandbox` is exposed
as `isolation.mode: weak` in the chart for clusters without user-namespace support and is off
by default.

The namespace is not labelled with a Pod Security Standard. `procMount: Unmasked` falls under
the *privileged* PSS level, so this namespace can never be `restricted`; the compensating
control is that the pod is unprivileged on the host because of the user namespace.

## Evidence

Spike on 2026-10-26 ([results](../spike/results-2026-10-26.md)): in the user-namespace pod the
full srt wrap ran as uid 1000 with reads denied, writes confined, the allowlisted domain
reachable through the proxy, a denied domain unreachable, nested user namespaces refused, and
4 pids visible inside the sandbox. The plain pod failed at the procfs mount in strict mode and
only worked in weak mode, where 18 pids (the whole container) were visible.

## Consequences

- Three boundaries stack: pod (cgroups, user namespace, Cilium policy), srt (bubblewrap mounts,
  network namespace removed, seccomp), and the proxy allowlist. A bubblewrap escape lands as an
  unprivileged uid inside a pod that still has no route except the proxy's.
- The pod runs AppArmor- and seccomp-unconfined. That is a real relaxation of the container
  layer, accepted because srt re-applies a stricter seccomp filter to the command it runs and
  because the user namespace removes the privilege a profile would otherwise guard.
- Volumes must support idmapped mounts: `local-path` (hostPath on ext4), `emptyDir`,
  ConfigMap and Secret volumes do; NFS does not (ADR-0008).
- `hostNetwork`, `hostPID` and `hostIPC` are impossible with `hostUsers: false`, which is also
  what we want.
- Enterprise ports that mandate PSS `restricted` need a different mechanism (ADR-0013): either
  a sandboxed RuntimeClass (gVisor or Kata) where the whole pod is the sandbox and srt can run
  in weak mode, or an exemption for one namespace governed by admission policy.

## Alternatives considered

- **Privileged pod or `CAP_SYS_ADMIN`**: makes strict mode work but any escape is root on the
  node; rejected.
- **Weak mode in an ordinary pod**: works everywhere, but the sandbox can see and signal the
  container's other processes and the deny mounts are only as strong as `--cap-drop ALL`;
  kept only as a fallback flag.
- **gVisor or Kata RuntimeClass**: strongest boundary (own kernel), but neither is installed on
  the k3s node, Kata needs nested virtualisation the box does not have, and gVisor's support for
  nested user namespaces and seccomp inside the sandbox is not something we could verify. Listed
  as the enterprise path, not the homelab one.
- **Running srt on the node as a systemd service and exposing it over SSH**: not GitOps, not
  isolated from the node, rejected.
