# 0017. Fleet management: Anthropic runs the brain, we run and watch the hands

Date: 2026-10-27
Status: Proposed

## Context

We asked how Anthropic's design expects a large fleet of sandboxes to be managed, and whether
the Claude Console is meant to be the control plane. From Anthropic's documentation (read
2026-10-27; sources on the Research page and in the fleet page):

- **Managed Agents.** Anthropic's control plane runs the model, the agent loop, the work queue,
  skills, memory stores and session history. The Console manages environments and keys,
  sessions (timeline, transcript, inspector), workspaces, webhooks and OpenTelemetry tracing of
  agent turns. Queue numbers come from `GET /v1/environments/{id}/work/stats` (`depth`,
  `pending`, `oldest_queued_at`, `workers_polling` as a count). There is no list of workers, no
  per-worker health, no autoscaler and no worker metrics endpoint. Anthropic's security model
  says isolation, egress, keys and log retention are the customer's.
- **Claude Code, Remote Control** (what our workspace uses): an admin on/off toggle and Trusted
  Devices; no admin list of Remote Control machines; telemetry doesn't name the machine.
- **Claude Code, self-hosted environments** (public beta, Team and Enterprise): runners
  (`claude self-hosted-runner`) on customer infrastructure, sessions started from claude.ai/code
  against the organisation's environment, an admin status and Activity view per environment,
  Prometheus `/metrics` on each runner, an example Kubernetes Deployment and an autoscaling
  orchestrator with a spawn hook, and explicit HPA/KEDA guidance on a pending-sessions metric.

So the Console is the control plane for the brain, not for the fleet of sandboxes.

## Decision

1. **Fleet orchestration stays ours**: the chart, one ArgoCD Application per sandbox (ADR-0016)
   and, for per-session sandboxes, the agent-sandbox controller (ADR-0015).
2. **Fleet visibility is a Grafana dashboard we build** from what the cluster already has:
   pod status per sandbox, ArgoCD sync health per sandbox, Hubble drops, srt denials from Loki.
3. **Queue numbers** come from a small exporter that calls the work-stats API per environment.
   It holds an Anthropic API key, so it runs outside the `claude-sandbox` namespace with a key
   scoped to one Console workspace. The sandbox pods still never hold an organisation key.
4. **Autoscaling** of Managed Agents workers uses KEDA on the exported `depth`, once workers are
   one sandbox per session.
5. **Enterprise port of the workspace kind**: replace `claude remote-control` with self-hosted
   environment runners inside the same sandbox pods, to gain Anthropic's admin Activity view,
   runner metrics and the orchestrator. Requires a Team or Enterprise plan; not tested in the
   homelab.

## Consequences

- Admins look in two places: the Console or claude.ai admin for sessions, spend and keys, and
  Grafana for the health of the sandboxes. That split mirrors Anthropic's responsibility split.
- The exporter introduces the first Anthropic API key in the cluster; scoping it to a workspace
  and keeping it out of the sandbox namespace is the control.
- Moving workspaces to runners changes the access path from Remote Control to cloud sessions on
  a self-hosted environment; ADR-0009 would be superseded.

## Alternatives considered

- **Treat the Console as the fleet dashboard**: it has no view of the workers.
- **Build our own control plane UI**: Grafana plus ArgoCD already give per-sandbox health and
  history; a UI adds little until the agent-sandbox controller is in place.
