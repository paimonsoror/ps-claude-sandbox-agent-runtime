# 0016. Sandbox definitions as files, one per sandbox

Date: 2026-10-26
Status: Accepted. Amends [0011](0011-gitops-delivery.md) (one Application) and the versioning
rule of [0014](0014-standalone-repository-and-oci-chart.md).

## Context

The first chart took its sandboxes as a list under `sandboxes:` in one values block. That works
for one or two but not for an enterprise fleet, for two mechanical reasons:

1. Helm cannot merge lists across values files: a second `-f` file with a `sandboxes:` list
   replaces the first. So every definition had to live in the same file.
2. A chart consumed from an OCI registry cannot discover files a consumer adds; only files
   packaged inside the chart are visible to `.Files`.

The owner asked for one definition per file in a subdirectory, discovered dynamically.

## Decision

Three layers, all in chart 0.1.0:

1. **Map schema with per-kind defaults.** `sandboxes` is a map keyed by sandbox name;
   `sandboxDefaults.<kind>` carries everything a definition does not state; a definition's
   `extraAllowedDomains` are appended rather than replacing. Maps deep-merge across values
   files, so `helm -f sandboxes/a.yaml -f sandboxes/b.yaml` composes any number of
   single-sandbox files, and a definition is typically three to six lines.
2. **Packaged files.** `sandboxFiles.glob` (default `sandboxes/*.yaml`) reads definition files
   from inside the chart directory for the vendored-chart case: a file is one definition (has
   `kind`; named after the file) or a map of definitions. The published package ships none,
   enforced by the chart workflow, so installing from the registry creates nothing until told.
3. **ApplicationSet for fleets.** `deploy/argocd/applicationset.yaml`: an ArgoCD
   ApplicationSet with a git *directory* generator over `sandboxes/*` in a definitions
   repository. Each directory holds a `values.yaml` with one `sandboxes.<name>` entry; the
   generator produces one Application per directory that installs the same OCI chart with two
   sources (the chart, and the git repository as a `$defs` ref for `valueFiles`: the shared
   `common.yaml` plus the directory's file). Each sandbox then has its own sync status,
   history and diff, directories map to CODEOWNERS, and adding a sandbox is adding a
   directory. The homelab adopts this layout in `homelab-charts/manifests/claude-sandboxes/`
   and the app-of-apps entry becomes a path entry for that directory.

Shared objects: with one Application per sandbox in one namespace, the chart's ServiceAccount
would be owned by every Application. The fleet layout sets `serviceAccount.create: false` and
uses the namespace's `default` account; the pod already does not mount its token.

**Versioning while in early development** (owner, 2026-10-26): changes keep landing in chart
`0.1.0`, republished by moving the `chart-v0.1.0` tag, until there are external consumers.
ArgoCD's repo-server caches an OCI chart by version, so a republish of the same version is
followed by a hard refresh of the Applications, or a restart of `argocd-repo-server` when the
refresh still serves the old package. ADR-0014's bump-per-change rule resumes at the first
external consumer.

## Consequences

- A fleet of N sandboxes is N directories and N Applications; the chart itself never grows.
- Two ways to define a sandbox exist (values map, packaged file) and both end in the same
  helper, so templates have one loop and one merged shape.
- The per-sandbox Application pattern is also the shape `kubernetes-sigs/agent-sandbox` would
  replace with a `SandboxTemplate` plus claims (ADR-0015): directories become template values.
- A list-style `sandboxes:` from the first chart is no longer accepted; the homelab entry is
  rewritten in the same change.

## Alternatives considered

- **Keep the list and generate values.yaml with a script**: fragile, and still one Application
  and one sync status for the whole fleet.
- **ApplicationSet git *files* generator**: flattens each file's keys into template parameters,
  which makes passing an arbitrary definition through to Helm awkward; the directory generator
  with `valueFiles` passes the file untouched.
- **Umbrella chart per team**: duplicates the chart's defaults and version pins per team.
