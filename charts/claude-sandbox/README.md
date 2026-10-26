# claude-sandbox

Sandboxed execution environments for Claude agents on the homelab cluster, built on Anthropic's
[sandbox-runtime](https://github.com/anthropics/sandbox-runtime) (bubblewrap on Linux) running
inside pod user namespaces. Every design decision is an ADR in the
[claude-srt](https://github.com/paimonsoror/ps-claude-sandbox-agent-runtime/tree/main/docs/adr) repository; this
README is the operator's summary.

## What it renders

For each enabled entry in `sandboxes`:

| Object | Purpose |
|---|---|
| `Deployment` (1 replica, Recreate) | the sandbox pod: `hostUsers: false`, `procMount: Unmasked`, non-root, no capabilities, read-only root |
| `ConfigMap` | `/etc/srt/settings.json` (proxy allowlist, write roots) and, for workspaces, `/etc/claude-code/managed-settings.json` |
| 2 x `PersistentVolumeClaim` | `/workspace` and `/home/agent`, kept on removal |
| `CiliumNetworkPolicy` | DNS to the cluster resolvers, TCP/443 to the same allowlisted names, nothing else; no ingress |
| `ExternalSecret` (optional) | the worker's environment key from Vault |

Two kinds:

- `workspace`: `srt -- claude remote-control` in server mode. Drive it from claude.ai/code or
  the Claude app. Needs a one-time `claude auth login` and a one-time confirmation over
  `kubectl attach` (see `NOTES.txt`).
- `managed-agents-worker`: `srt -- ant beta:worker poll`. Serves one Anthropic Managed Agents
  self-hosted environment; needs the environment key Secret.

## Requirements

- Kubernetes >= 1.33 with user namespaces enabled (GA in 1.36), containerd >= 2.0, kernel
  >= 6.3, a StorageClass whose volumes support idmapped mounts (`local-path` does; NFS does
  not). Verified on k3s v1.36.4 / containerd 2.3.4 / kernel 6.8.
- Cilium with the DNS proxy for `network.policy.engine: cilium`; otherwise set `kubernetes`.
- The namespace must not enforce Pod Security Standard `restricted` or `baseline`
  (`procMount: Unmasked` and the unconfined profiles are *privileged*-level fields; the pod is
  nevertheless unprivileged on the host because of the user namespace).

Clusters without user namespaces: `isolation.mode: weak` (srt's `enableWeakerNestedSandbox`),
ideally together with `isolation.runtimeClassName` pointing at gVisor or Kata.

## Image

Built from `images/claude-sandbox` by the `claude-sandbox image` workflow and pushed to
`ghcr.io/paimonsoror/claude-sandbox:sha-<short>`. Pins (`CLAUDE_CODE_VERSION`, `SRT_VERSION`,
`ANT_VERSION`) are Dockerfile build args. The ArgoCD entry sets `image.tag`.

## Values worth knowing

| Key | Default | Meaning |
|---|---|---|
| `isolation.mode` | `strict` | `strict` (user namespace, full bubblewrap) or `weak` |
| `isolation.wrap` | `srt` | wrap the whole process with srt, or use Claude Code's per-command Bash sandbox instead |
| `network.baseAllowedDomains` | `[api.anthropic.com]` | names every sandbox may reach; each sandbox adds its own `allowedDomains` |
| `network.policy.engine` | `cilium` | `cilium`, `kubernetes` or `none` |
| `debug.srt` | `false` | `SRT_DEBUG=1` (prints every proxy decision and denial) |
| `sandboxes[].repo` | `""` | git URL cloned into the empty workspace on first start |
| `sandboxes[].remoteControl.permissionMode` | `default` | starting permission mode of Remote Control sessions |

## Verifying the boundary

From a Remote Control session (or by asking the worker's agent):

```
curl -sI https://example.com          # 403 from the proxy: not allowlisted
curl -sI http://10.43.0.1             # blocked: resolved-address guard and network policy
touch /usr/local/bin/x; touch /etc/x  # read-only root filesystem
echo x >> ~/.bashrc                   # mandatory write deny
unshare -Ur true                      # nested user namespace refused
cat /proc/self/uid_map                # 0 <large host uid> 65536
```
