# 0011. GitOps delivery through the app-of-apps

Date: 2026-10-26
Status: Accepted

## Context

Everything on the cluster is an ArgoCD Application rendered from
`charts/argocd-apps/values.yaml` in `homelab-charts`. Conventions in that repository: one commit
per app change, `image.tag` pinned per build (`sha-<short>`), `ServerSideApply=true` and
`CreateNamespace=true` in `syncOptions`, secrets created out of band and referenced by name,
`tools/bump.py` for version bumps, and the `argocd-sync-watcher` CronJob to sync after merges.
ArgoCD is v2.14.9 and renders with `helm template` (no `lookup`).

## Decision

- `charts/argocd-apps/values.yaml` gets an entry `claude-sandbox` whose source is the
  published OCI chart (`repoURL: ghcr.io/paimonsoror/charts`, `chart: claude-sandbox`,
  `targetRevision: <chart version>`; ADR-0014), destination namespace `claude-sandbox`,
  `automated: {}` sync, `CreateNamespace=true`, `ServerSideApply=true`. The entry is committed
  with `enabled: false` and flipped to `true` once the image and chart workflows have pushed,
  so the first sync does not start with an `ImagePullBackOff`.
- The entry carries two pins: the chart version in `targetRevision` (kind `chart` for
  `tools/bump.py`) and `image.tag: sha-<short>` in the `helm.values` block (kind `image`).
- The image workflow in `ps-claude-sandbox-agent-runtime` runs on pushes to `main` that touch
  `images/claude-sandbox/**` and on manual dispatch, builds `linux/amd64`, and pushes
  `sha-<short>` and `main` tags to `ghcr.io/paimonsoror/claude-sandbox` with the repository's
  `GITHUB_TOKEN` (package visibility public, like `courier-controller`). The Dockerfile pins
  `@anthropic-ai/sandbox-runtime`, `@anthropic-ai/claude-code` and `ant` versions as build
  args; a bump is a one-line change plus the resulting tag roll.
- Secrets the chart references but does not create: `claude-sandbox-github` (optional),
  `claude-sandbox-managed-agents` (worker). The chart's `NOTES.txt` lists them.
- No Pod Security Admission labels are added to the namespace (none exist cluster-wide); the
  chart documents that it cannot run under `restricted`.

## Consequences

- Rolling out a new srt or Claude Code version is a PR that changes a build arg, a merged image
  build, and a PR that changes the tag: the same two-step shape the cluster already uses.
- ArgoCD's old diff engine needed the `/status` ignore workaround for Deployments; the chart's
  objects are plain Deployments, PVCs, ConfigMaps and a CiliumNetworkPolicy, all of which it
  already manages elsewhere.
- Because the pod spec uses `hostUsers` and `procMount`, `helm template` output is validated
  against the live API with a server-side dry run in the plan before the entry is enabled.

## Alternatives considered

- **Chart path inside `homelab-charts`**: the first choice (ADR-0002), reversed by ADR-0014
  before anything was committed.
- **`latest` tag**: the cluster's convention is immutable tags; `latest` would also defeat the
  bump tooling.
