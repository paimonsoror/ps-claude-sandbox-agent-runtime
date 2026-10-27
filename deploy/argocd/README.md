# ArgoCD delivery

Two ways to deliver the chart through an app-of-apps (ADR-0011, ADR-0016). The homelab uses
the second.

## A. One Application, inline definitions

Good for a handful of sandboxes. The `helm.values` block carries a `sandboxes` map:

```yaml
    - name: claude-sandbox
      enabled: true
      spec:
        project: default
        source:
          repoURL: ghcr.io/paimonsoror/charts
          chart: claude-sandbox
          targetRevision: 0.1.0
          helm:
            values: |-
              image:
                tag: sha-50409b3
              sandboxes:
                homelab:
                  kind: workspace
                  repo: https://github.com/paimonsoror/homelab-charts.git
                  remoteControl:
                    spawn: worktree
                worker:
                  kind: managed-agents-worker
                  enabled: false
        destination:
          server: 'https://kubernetes.default.svc'
          namespace: claude-sandbox
        syncPolicy:
          automated: {}
          syncOptions:
            - CreateNamespace=true
            - ServerSideApply=true
```

## B. One Application per sandbox directory (fleet)

[`applicationset.yaml`](applicationset.yaml) plus a directory per sandbox in the definitions
repository. In homelab-charts:

```
manifests/claude-sandboxes/
  applicationset.yaml
  common.yaml                      image.tag, isolation, network, serviceAccount.create: false
  sandboxes/homelab/values.yaml    sandboxes: { homelab: { kind: workspace, ... } }
  sandboxes/worker/values.yaml     sandboxes: { worker: { kind: managed-agents-worker, enabled: false } }
```

and one app-of-apps entry pointing at the directory:

```yaml
    - name: claude-sandboxes
      enabled: true
      spec:
        project: default
        source:
          repoURL: https://github.com/paimonsoror/homelab-charts
          path: manifests/claude-sandboxes
          targetRevision: HEAD
          directory:
            include: applicationset.yaml
        destination:
          server: 'https://kubernetes.default.svc'
          namespace: argocd
        syncPolicy:
          automated: {}
          syncOptions:
            - ServerSideApply=true
```

The ApplicationSet generates `claude-sandbox-homelab`, `claude-sandbox-worker`, one per
directory, each with its own sync status. To roll the image for all: edit `common.yaml`. To
roll the chart: `targetRevision` in the ApplicationSet. `tools/bump.py` handles neither yet;
both are plain YAML scalars.

## Secrets (never created by the chart)

```bash
kubectl -n claude-sandbox create secret generic claude-sandbox-github --from-literal=token=github_pat_...
kubectl -n claude-sandbox create secret generic claude-sandbox-managed-agents \
  --from-literal=ANTHROPIC_ENVIRONMENT_ID=env_... --from-literal=ANTHROPIC_ENVIRONMENT_KEY=sk-ant-oat01-...
```

## Republishing 0.1.0

While the chart stays at 0.1.0 (ADR-0016), a republish is `git tag -f chart-v0.1.0 && git push -f origin chart-v0.1.0`.
ArgoCD's repo-server caches the package by version; after the workflow finishes:

```bash
kubectl -n argocd annotate application -l claude-sandbox/name argocd.argoproj.io/refresh=hard --overwrite
# if the diff still shows the old chart:
kubectl -n argocd rollout restart deploy/argocd-repo-server
```
