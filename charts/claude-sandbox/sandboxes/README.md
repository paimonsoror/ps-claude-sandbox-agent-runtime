# Packaged sandbox definitions

Any `*.yaml` file in this directory is read by the chart (`sandboxFiles.glob`) and merged with
the kind's `sandboxDefaults`. The published chart ships none, so installing it from the OCI
registry creates no sandbox until values or files define one.

Use this directory when the chart is vendored into a repository and deployed by path. For a
chart consumed from the registry, put each definition in its own values file instead, or use
the ArgoCD ApplicationSet in `deploy/argocd/` (ADR-0016). Examples: `examples/sandboxes/`.

A file is either one definition (it has `kind`; the name is the file name unless `name` is
set) or a map of `name: definition`.
