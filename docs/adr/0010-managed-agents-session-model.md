# 0010. Managed Agents session model: always-on worker first

Date: 2026-10-26
Status: Accepted

## Context

Anthropic's self-hosted sandboxes offer two axes: how work is claimed (always-on poller or
webhook-triggered) and where a session runs (in the poller's process and shared workdir, or one
fresh sandbox per session via `--on-work` or the SDK poller). Anthropic recommends the
per-session form "for stronger isolation: a fresh filesystem, resource limits, or per-session
network controls", and notes that memory stores and the per-session work secret must be passed
only into the sandbox serving that session.

Per-session pods on Kubernetes need something that can create pods: a spawner with RBAC, a Job
template, or the `kubernetes-sigs/agent-sandbox` controller (Sandbox, SandboxTemplate,
SandboxWarmPool, SandboxClaim CRDs, v1.0.x, runtime-agnostic). The GKE reference for this exact
use case uses that controller with gVisor and a warm pool.

## Decision

- **v1**: one always-on worker pod per Managed Agents environment, running
  `ant beta:worker poll --workdir /workspace --log-format json` inside srt. Sessions share the
  worker's `/workspace`; `--max-idle` stays at the 60 s default. The environment is dedicated to
  this homelab worker and to one trust boundary (the owner), which is what Anthropic's guidance
  asks for when isolation per session is not provided.
- **v2 (planned, phase 6)**: per-session pods. The poller runs with `--on-work` and a spawn
  script that creates a Kubernetes Job from the same sandbox pod template, forwarding the
  `ANTHROPIC_*` variables and the work secret as a Job-scoped Secret. The `agent-sandbox`
  controller is the candidate once it is evaluated on k3s; its warm pool would remove the
  pod-start latency.

## Consequences

- v1 isolation between two sessions of the same environment is the filesystem under
  `/workspace` only; a session can read what the previous one left. Acceptable for a single
  owner's environment, not for a shared enterprise one (ADR-0013).
- The worker needs only `api.anthropic.com` on 443 plus whatever its tasks fetch; its allowlist
  is the smallest of the two kinds.
- `ant` is pinned in the image (2.3.0) and the beta header the docs name
  (`managed-agents-2026-04-01`) is what that version speaks; upgrades go through an image rebuild.

## Alternatives considered

- **Per-session Jobs from day one**: needs a spawner with `create jobs` RBAC in the namespace
  and a Secret per session; more moving parts than the first deployment should carry.
- **Webhook-triggered worker**: avoids an idle poller, but needs an inbound endpoint Anthropic
  can reach, which ADR-0009 rules out for v1.
