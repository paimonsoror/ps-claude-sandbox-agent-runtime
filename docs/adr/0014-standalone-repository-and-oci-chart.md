# 0014. Standalone repository and OCI chart

Date: 2026-10-26
Status: Accepted. Supersedes the repository-layout part of [0002](0002-target-platform-and-repository-layout.md).

## Context

ADR-0002 placed the chart and image inside `homelab-charts`. Once the chart existed the owner
asked for a standalone project instead, created `github.com/paimonsoror/ps-claude-sandbox-agent-runtime`,
and asked for the pivot before anything was committed. The cluster already consumes one OCI
chart this way (TelltaleDNS from `ghcr.io/paimonsoror/charts`, registered in the app-of-apps as
the `telltale-charts` repository), so the delivery path exists.

## Decision

`ps-claude-sandbox-agent-runtime` is the single home for everything:

| Path | Contents |
|---|---|
| `charts/claude-sandbox/` | the Helm chart, with `ci/*-values.yaml` used by lint and render checks |
| `images/claude-sandbox/` | Dockerfile and entrypoint |
| `.github/workflows/image.yml` | builds and pushes `ghcr.io/paimonsoror/claude-sandbox:sha-<short>` and `:main` |
| `.github/workflows/chart.yml` | lints and renders the chart on every push; on a `chart-v*` tag packages it and pushes `oci://ghcr.io/paimonsoror/charts/claude-sandbox:<version>` |
| `docs/` | ADRs, plan, spike evidence, controls matrix, north-star comparison, explainer page |
| `deploy/argocd/` | the Application entry to paste into `homelab-charts` |
| `sandbox-runtime/` | git submodule pinned to the upstream commit the design was read against (`98a4016`) |

`homelab-charts` keeps only the Application entry, pointing at the OCI chart. Its
`argoconfig.repositories` already registers `ghcr.io/paimonsoror/charts`, so no new repository
Secret is needed.

Versioning: the chart's `version` is bumped in a PR, the tag `chart-v<version>` publishes it,
and the Application's `targetRevision` is rolled to that version. The image is rolled
independently by `image.tag`.

## Consequences

- The chart is reusable from any cluster with `helm install cs oci://ghcr.io/paimonsoror/charts/claude-sandbox`.
- Two pins in the app-of-apps entry instead of one (chart version and image tag), both in the
  shapes `tools/bump.py` already handles.
- The design docs and the deployable artifact share one history, which is what ADR-0001 wants.
- The upstream clone becomes a submodule; `git submodule update --init` is needed after a fresh
  clone to read it, and nothing in the build depends on it.

## Alternatives considered

- **Stay in `homelab-charts`**: the choice of ADR-0002, reversed by the owner.
- **Chart in the new repository, image workflow in `homelab-charts`**: splits one artifact's
  history across two repositories for no gain.
