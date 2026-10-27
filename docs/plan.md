# Implementation plan: Claude sandbox on the homelab k3s cluster

Goal: a running, GitOps-delivered sandbox environment on the homelab cluster (192.168.5.2) that
Claude agents execute in, built on Anthropic's `sandbox-runtime`, with two consumers in scope:
Claude Code workspaces driven over Remote Control, and an Anthropic Managed Agents self-hosted
environment worker. Decisions are in [`adr/`](adr/README.md); this document sequences them.

Status legend: `done`, `ready` (files written, waiting on a human step), `todo`, `later`.

## Phase 0: feasibility `done`

| Step | Result |
|---|---|
| Probe the node (kernel, k3s, containerd, sysctls, AppArmor, storage, ArgoCD) | Ubuntu 22.04.5, kernel 6.8, k3s 1.36.4, containerd 2.3.4, userns sysctls open, AppArmor on, `local-path` only, ArgoCD 2.14.9. No node change needed. |
| Spike two pods in `testing` ([spike](spike/results-2026-10-26.md)) | Full-strength srt works in a `hostUsers: false` + `procMount: Unmasked` pod as uid 1000. Plain pod only works in weak mode. Pods deleted afterwards. |
| Confirm Claude Code facts from the docs | Remote Control needs a `/login` credential (not `setup-token`), honours `sandbox.enabled` from settings, needs feature flags on, needs a TTY once for its confirmation; trust is pre-seedable in `~/.claude.json`; Claude Code 2.1.311 is current; `DISABLE_UPDATES=1` pins. |

## Phase 1: image and chart `ready`

Files are staged on branch `claude-sandbox` of the local `homelab-charts` clone (not committed):

- `images/claude-sandbox/Dockerfile`, `entrypoint.sh`
- `.github/workflows/claude-sandbox-image.yml`
- `charts/claude-sandbox/` (Chart.yaml, values.yaml, templates, README.md)
- `charts/argocd-apps/values.yaml`: new `claude-sandbox` entry, `enabled: false`

Checks already run locally: `helm lint`, `helm template` with the default and the weak-mode
values, and a server-side dry run of the rendered manifests against the live API (see the
verification log at the end of this file once run).

Human steps:

1. Review the branch diff in `homelab-charts`; commit as `claude-sandbox: add chart, image and
   Application entry (disabled)`; open a PR; merge.
2. Run the `claude-sandbox-image` workflow (it also runs on the merge because the image path
   changed). Note the `sha-<short>` tag it pushes to `ghcr.io/paimonsoror/claude-sandbox`.
   Make the package public the first time (GitHub package settings), as for `courier-controller`.

## Phase 2: first workspace `in progress`

**Done 2026-10-27:** the ApplicationSet cutover is merged; `claude-sandbox-homelab` is Synced
and Healthy; the pod runs as uid 1000 in a user namespace (`uid_map 0 3707240448 65536`) with
a read-only root; it cloned homelab-charts into `/workspace` and waits for the login.
A DNS defect was found and fixed on the way: the Cilium policy allowed port 53 to the
TelltaleDNS pods, which listen on 5353 behind their :53 Service, so queries to the first
resolver were dropped until the fallback to CoreDNS (Hubble: `Policy denied DROPPED` to
`telltaledns-0:5353`). Each DNS endpoint now carries its port; after the republish and a hard
refresh the probes from inside the pod (outside bubblewrap) read: `github.com:443 -> 200`,
`api.anthropic.com:443 -> 404` (reached), `example.com:443 -> 000` (blocked),
`192.168.3.3:443 -> 000` (blocked).

**Done 2026-10-27, steps 4 to 7:** the owner ran `claude auth login` and answered the Remote
Control confirmation over `kubectl attach`; `claude auth status` exits 0; the process tree is
`tini → srt → socat relays → claude remote-control --spawn worktree --capacity 8`. Boundary
probes run as a fresh `srt --settings /etc/srt/settings.json -c …` wrap in the pod (the same
policy the sessions get):

| Probe | Result |
|---|---|
| `id -u; cat /proc/self/uid_map; ls /proc` | uid 1000, map `1000 1000 1`, 4 pids visible |
| `curl https://api.github.com/` | 200 (allowed name) |
| `curl https://example.com/` | 000 (not listed) |
| `curl http://10.43.0.1/` | 000 (cluster API: resolved-address guard, CNI) |
| `curl https://truenas.sororlab.dev/` | 000 (LAN name resolves to a private address) |
| `touch /etc/x`, `touch /usr/local/bin/x` | read-only file system |
| `echo x >> /workspace/.bashrc` | permission denied (mandatory deny) |
| `echo x > /workspace/.git/hooks/post-checkout` | read-only file system (mandatory deny) |
| `cat /etc/srt/settings.json` | no such file (denyRead) |
| `unshare -Ur true` | operation not permitted |
| `touch /workspace/ok-from-sandbox`, `git status` | ok |

Finding: srt's mount-point files for the denied shell startup files show up as untracked
`.bashrc` and `.bash_profile` in `/workspace` while the server runs. The entrypoint now adds
those names to `.git/info/exclude`; the fix ships with the next image tag. Step 8 (this log)
done; the phase closes when the next image is rolled.

1. Create the optional GitHub token Secret (fine-grained PAT, contents + pull requests on the
   repositories the workspace will clone):
   ```bash
   kubectl create namespace claude-sandbox
   kubectl -n claude-sandbox create secret generic claude-sandbox-github --from-literal=token=github_pat_...
   ```
   Skip it if the workspace should only read public repositories.
2. In `charts/argocd-apps/values.yaml`, set `image.tag: sha-<short>` and `enabled: true` for
   `claude-sandbox`; commit `claude-sandbox: enable, image sha-<short>`; merge. The sync watcher
   syncs within two minutes; or hard-refresh `argocd-apps` and sync `claude-sandbox`.
3. Watch the pod come up:
   ```bash
   kubectl -n claude-sandbox get pods -w
   kubectl -n claude-sandbox logs deploy/claude-sandbox-homelab -f
   ```
   Expected: the entrypoint prints the srt dependency check, clones the repository if configured,
   then prints `Waiting for a claude.ai login at /home/agent/.claude/.credentials.json` every
   30 s.
4. Log in once (paste-code flow, no browser in the pod):
   ```bash
   kubectl -n claude-sandbox exec -it deploy/claude-sandbox-homelab -- claude auth login
   ```
   Open the printed URL on the laptop, approve, paste the code back. `claude auth status` must
   exit 0.
5. The entrypoint notices the credential and starts `srt -- claude remote-control`. Attach once
   to answer the one-time `Enable Remote Control? (y/n)` confirmation:
   ```bash
   kubectl -n claude-sandbox attach -it deploy/claude-sandbox-homelab
   ```
   Answer `y`. Detach with `Ctrl-P Ctrl-Q`. The confirmation is remembered on the home volume.
6. Open claude.ai/code or the Claude app: a session named `homelab-<adjective>-<animal>` is
   listed. Send `uname -a && id && cat /proc/self/uid_map && ls /workspace` and confirm the
   answer shows the pod hostname, uid 1000, a 65536-wide uid map, and the repository.
7. Verify the boundary from inside a session (each should fail):
   - `curl -sI https://example.com` (not allowlisted; srt returns 403 or no route)
   - `curl -sI http://10.43.0.1` (cluster API; blocked by srt's resolved-address guard and by
     the Cilium policy)
   - `touch /etc/x`, `touch /usr/local/bin/x` (read-only root and outside allowWrite)
   - `echo x >> ~/.bashrc` (mandatory deny)
   - `unshare -Ur true` (nested user namespace refused)
   - `cat /home/agent/.claude/.credentials.json` succeeds for Claude Code itself (needed);
     note it in the controls matrix as the accepted residual.
   And each should work: `git status` in `/workspace`, `npm view left-pad version`,
   `curl -sI https://api.github.com`.
8. Record the results in `docs/verification.md`.

## Phase 3: Managed Agents worker `todo`

1. In the Claude Console: create an agent (or reuse one), create an environment with hosting
   `Self-hosted`, generate an environment key.
2. Create the Secret out of git:
   ```bash
   kubectl -n claude-sandbox create secret generic claude-sandbox-managed-agents \
     --from-literal=ANTHROPIC_ENVIRONMENT_ID=env_... \
     --from-literal=ANTHROPIC_ENVIRONMENT_KEY=sk-ant-oat01-...
   ```
3. Set `enabled: true` on the `worker` entry in the Application's values; merge; sync.
4. From the laptop (API key stays there), confirm `workers_polling >= 1`:
   ```bash
   ant beta:environments:work stats --environment-id "$ANTHROPIC_ENVIRONMENT_ID"
   ```
5. Start a session that writes `uname -a` to `hello.txt`; confirm the file appears under
   `/workspace` in the worker pod and that the kernel string is the node's.
6. Verify the worker's boundary the same way as step 2.7 by asking the agent to run the probes.

## Phase 4: hardening and operations `todo`

- Add `deniedResolvedAddresses` for 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (already in
  the chart's default srt settings; confirm with a `curl` to `truenas.sororlab.dev`).
- Save the Loki violation query as a Grafana dashboard panel in folder `Claude sandbox`.
- Turn `debug.srt` on for one day, review what the proxy denied, trim or extend the allowlist,
  turn it off.
- Confirm `kubectl -n claude-sandbox exec` is the only interactive path and that no Service
  exists in the namespace.
- Write `docs/runbook.md` from the operations list in ADR-0012 after the first incident-free
  week.
- Enable the `ExternalSecret` template for the worker key once a `claude-sandbox` Vault path
  and SecretStore exist (reuse the `courier-vault` pattern).

## Phase 5: browser terminal (optional) `later`

A `ttyd` sidecar or a dedicated `code-server` entry behind Authentik forward-auth on the Cilium
ingress, mounting a workspace volume read-only for review. Needs an ADR that amends 0009.

## Phase 6: per-session sandboxes for Managed Agents `later`

- Poller with `--on-work` spawning a Job from the sandbox pod template, forwarding the
  `ANTHROPIC_*` variables and the work secret as a per-Job Secret; RBAC limited to Jobs and
  Secrets in the namespace.
- Evaluate `kubernetes-sigs/agent-sandbox` (Sandbox, SandboxTemplate, SandboxWarmPool,
  SandboxClaim) on k3s as the controller for this; it is also the shape of the enterprise
  control plane (see the north-star page).

## Phase 7: portability `later`

- `helm package` the chart and publish to `ghcr.io/paimonsoror/charts/claude-sandbox`; switch
  the Application to the OCI chart (the TelltaleDNS pattern) when a second cluster appears.
- `isolation.mode: weak` plus a `RuntimeClass` value is the path to a cluster that runs gVisor
  or Kata and enforces PSS `restricted`.

## Verification log

**2026-10-26, phase 1 (chart and image authored):**

- `helm lint charts/claude-sandbox` with `ci/all-enabled-values.yaml`: 0 failures.
- `helm template` with `ci/all-enabled-values.yaml`: 11 objects (1 ServiceAccount,
  2 ConfigMaps, 4 PVCs, 2 Deployments, 2 CiliumNetworkPolicies); rendered copy kept at
  [`spike/rendered-all-enabled.yaml`](spike/rendered-all-enabled.yaml).
- `helm template` with `ci/weak-fallback-values.yaml` (weak mode, Claude Bash sandbox,
  Kubernetes NetworkPolicy, ExternalSecret, gVisor RuntimeClass): 12 objects, flags present.
- `kubectl apply --dry-run=server` of the strict rendering against the live cluster (namespace
  `testing`): all 11 objects accepted, so `hostUsers`, `procMount: Unmasked`,
  `appArmorProfile` and the Cilium policy schema are valid on k3s v1.36.4 / Cilium 1.20.1.
- The app-of-apps chart renders the new `claude-sandbox` Application entry.
- Image built by the `image` workflow on the first push (run 40421421697) and again by a manual
  dispatch: `ghcr.io/paimonsoror/claude-sandbox:sha-50409b3` and `:main`, package public
  (anonymous manifest fetch returns 200). `chart` workflow lint passed on the same commit.
- Tag `chart-v0.1.0` pushed; the `chart` workflow published
  `oci://ghcr.io/paimonsoror/charts/claude-sandbox:0.1.0`
  (digest `sha256:d4d1a023…`), fetched anonymously with `helm show chart`.
- The homelab-charts entry (`targetRevision: 0.1.0`, `image.tag: sha-50409b3`,
  `enabled: true`) is committed as 5d0d55f on branch `claude-sandbox` and pushed. Merging it
  into `main` is the deploy and is the owner's action (the session's policy blocks pushes to
  the production app-of-apps branch).
- `docs/runbook.md` written ahead of phase 4.
- Merged into homelab-charts `main` (5d0d55f) at the owner's request. The Application came up
  `Sync: Unknown` with `ComparisonError ... pvc.yaml: index of untyped nil`: the inline entry
  stated only `kind`, `repo` and `remoteControl`, and the first 0.1.0 package had no per-kind
  defaults, so `persistence` was nil. The ci values had carried full entries, which is why lint
  passed. Fixed by the defaults in ADR-0016 (below); the ci values now mirror the real entries.

**2026-10-26, definitions as files (ADR-0016):** `sandboxes` became a map with per-kind
defaults, packaged `sandboxes/*.yaml` are read, and an ApplicationSet (one Application per
directory) is the fleet layout. Renders verified: inline map, three packaged files (one a map
file), two merged values files, a disabled definition omitted, empty chart renders only the
ServiceAccount. Chart stays 0.1.0 and is republished by moving the tag (owner decision).
Homelab cutover staged on branch `claude-sandboxes-appset`: `manifests/claude-sandboxes/`
(ApplicationSet, `common.yaml`, `sandboxes/homelab`, `sandboxes/worker`) and the app-of-apps
entry `claude-sandboxes` replacing the inline `claude-sandbox` entry. After the merge: hard
refresh or restart `argocd-repo-server` so the republished 0.1.0 is fetched.
