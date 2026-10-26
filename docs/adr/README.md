# Architecture Decision Records: Claude sandbox on the homelab

Decisions for running Anthropic's [sandbox-runtime](https://github.com/anthropics/sandbox-runtime)
on the homelab k3s cluster as an execution environment for Claude agents. One decision per file,
numbered, never edited once accepted; a change is a new ADR that supersedes the old one.

| # | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-target-platform-and-repository-layout.md) | Target platform and repository layout | Accepted; layout superseded by 0014 |
| [0003](0003-isolation-model-pod-user-namespace-and-full-bubblewrap.md) | Isolation model: pod user namespace plus full-strength bubblewrap | Accepted |
| [0004](0004-two-sandbox-kinds-workspace-and-managed-agents-worker.md) | Two sandbox kinds: Claude Code workspace and Managed Agents worker | Accepted |
| [0005](0005-one-bubblewrap-layer-srt-wraps-the-whole-process.md) | One bubblewrap layer: srt wraps the whole process | Accepted |
| [0006](0006-egress-control-in-two-layers.md) | Egress control in two layers from one domain list | Accepted |
| [0007](0007-credentials-and-secrets.md) | Credentials and secrets | Accepted |
| [0008](0008-storage.md) | Storage: local-path volumes, read-only root filesystem | Accepted |
| [0009](0009-access-path-remote-control-first.md) | Access path: Remote Control first, no ingress in v1 | Accepted |
| [0010](0010-managed-agents-session-model.md) | Managed Agents session model: always-on worker first | Accepted |
| [0011](0011-gitops-delivery.md) | GitOps delivery through the app-of-apps | Accepted |
| [0012](0012-operations-and-observability.md) | Operations and observability | Accepted |
| [0013](0013-control-framework-alignment-and-enterprise-porting.md) | Control framework alignment and enterprise porting | Accepted |
| [0014](0014-standalone-repository-and-oci-chart.md) | Standalone repository and OCI chart | Accepted |
| [0015](0015-north-star-control-plane-over-pluggable-substrates.md) | North star: a control plane over pluggable sandbox substrates | Proposed |

## Template

```markdown
# NNNN. Title

Date: YYYY-MM-DD
Status: Proposed | Accepted | Superseded by NNNN

## Context
## Decision
## Consequences
## Alternatives considered
```

Evidence that an ADR relies on lives under [`../spike/`](../spike/). The implementation plan that
sequences them is [`../plan.md`](../plan.md). The control mapping that ADR-0013 summarises is
[`../controls-matrix.md`](../controls-matrix.md).
