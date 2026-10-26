# ArgoCD app-of-apps entry

The entry below is what `homelab-charts/charts/argocd-apps/values.yaml` carries for this
project (staged on its `claude-sandbox` branch). It consumes the published OCI chart; the
registry `ghcr.io/paimonsoror/charts` is already registered there as `telltale-charts`.

Roll the two pins independently: `targetRevision` is the chart version (tag `chart-v<version>`
in this repository), `image.tag` is the image build (`sha-<short>` from the `image` workflow).

```yaml
    - name: claude-sandbox
      enabled: false   # true once the image and chart have been published
      spec:
        project: default
        source:
          repoURL: ghcr.io/paimonsoror/charts
          chart: claude-sandbox
          targetRevision: 0.1.0
          helm:
            values: |-
              image:
                tag: sha-0000000
              sandboxes:
                - name: homelab
                  kind: workspace
                  enabled: true
                  repo: https://github.com/paimonsoror/homelab-charts.git
                  remoteControl:
                    spawn: worktree
                    capacity: 8
                    permissionMode: default
                - name: worker
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

Secrets the chart references but never creates (create them in `claude-sandbox` by hand or
through the optional `ExternalSecret`):

```bash
kubectl -n claude-sandbox create secret generic claude-sandbox-github --from-literal=token=github_pat_...
kubectl -n claude-sandbox create secret generic claude-sandbox-managed-agents \
  --from-literal=ANTHROPIC_ENVIRONMENT_ID=env_... --from-literal=ANTHROPIC_ENVIRONMENT_KEY=sk-ant-oat01-...
```
