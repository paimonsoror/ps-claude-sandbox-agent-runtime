# 0009. Access path: Remote Control first, no ingress in v1

Date: 2026-10-26
Status: Accepted

## Context

The owner drives Claude Code from a laptop, a browser and a phone. Claude Code's Remote Control
connects claude.ai/code and the mobile app to a session running anywhere, over an outbound
connection the session opens. In server mode (`claude remote-control`) one process serves up to
32 sessions, creates a new session per request from the phone, can give each its own git
worktree, and crashed sessions are re-served when messaged. It needs: a claude.ai login
(ADR-0007), feature-flag fetching enabled, a TTY for two one-time prompts (workspace trust,
which we pre-seed, and the "Enable Remote Control?" confirmation, which has no documented
non-interactive bypass), and about 10 minutes of tolerance for network outages before the
server exits.

Alternatives for reaching the pod directly (web terminal, SSH) all require an ingress or a
LoadBalancer, an identity layer (Authentik is available) and a listening port inside the
sandbox pod, which ADR-0006 forbids.

## Decision

- The workspace's user interface is **Remote Control**: the pod runs `claude remote-control`
  with `--spawn worktree`, `--capacity 8` and the session name prefix set to the sandbox name,
  so sessions appear as `homelab-<adjective>-<animal>` in the session list.
- The pod has `tty: true` and `stdin: true`. Bootstrap (`claude auth login`, the one-time
  confirmation) is done with `kubectl exec -it` / `kubectl attach -it`, documented in the
  runbook. After that the pod needs no interactive access.
- **No ingress, no Service, no LoadBalancer** for sandbox pods in v1. The Cilium policy denies
  all ingress.
- The server's exit after a long outage is handled by the Deployment's restart; `--continue`
  is not used because the sessions are re-created on demand anyway.

Deferred to a later phase (plan, phase 5): a `ttyd` sidecar or a `code-server` entry behind
Authentik for a browser terminal, which would need an ingress exception and its own ADR.

## Consequences

- Zero inbound attack surface on the sandbox namespace.
- The owner's phone sees the sandbox as another machine; the Claude Desktop app can also drive
  it. Only one remote connection per session at a time.
- Everything the owner types travels through Anthropic's Remote Control relay; the code never
  leaves the cluster except as model context, which is true of any Claude Code use.
- The one-time confirmation requires a human with `kubectl` once per Claude home volume.

## Alternatives considered

- **code-server already in the cluster** (`code.sororlab.dev`): it runs as a different pod with
  the host's `homelab-charts` checkout mounted; sharing the sandbox's PVC would break the
  boundary. Could later mount a sandbox workspace read-only for review.
- **SSH into the pod**: needs sshd listening, keys to manage and an ingress; rejected.
- **`claude --remote-control` interactive mode under tmux**: one session per process; server
  mode is the better fit for a long-lived pod.
