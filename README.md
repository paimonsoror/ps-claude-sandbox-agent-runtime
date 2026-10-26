# ps-claude-sandbox-agent-runtime

Sandboxed execution environments for Claude agents on a Kubernetes homelab, built on Anthropic's
[sandbox-runtime](https://github.com/anthropics/sandbox-runtime) (bubblewrap) running at full
strength inside pod user namespaces, delivered by GitOps.

Two kinds of sandbox come out of one Helm chart:

- **workspace**: Claude Code itself, wrapped by `srt`, in `claude remote-control` server mode.
  Driven from claude.ai/code or the Claude mobile app. No inbound network at all.
- **managed-agents-worker**: Anthropic's Managed Agents self-hosted environment worker
  (`ant beta:worker poll`), wrapped by `srt`, so Managed Agents sessions execute tool calls in
  the homelab.

## Layout

| Path | What |
|---|---|
| [`charts/claude-sandbox`](charts/claude-sandbox) | the chart (published as `oci://ghcr.io/paimonsoror/charts/claude-sandbox`) |
| [`images/claude-sandbox`](images/claude-sandbox) | the image (`ghcr.io/paimonsoror/claude-sandbox`) |
| [`docs/plan.md`](docs/plan.md) | the phased implementation plan with the human steps |
| [`docs/adr`](docs/adr/README.md) | every decision, numbered |
| [`docs/controls-matrix.md`](docs/controls-matrix.md) | the build measured against published agent-sandbox controls, with enterprise porting notes |
| [`docs/north-star.md`](docs/north-star.md) | the control-plane-over-substrates target, decoded and compared |
| [`docs/spike`](docs/spike) | the feasibility evidence from the cluster |
| [`docs/sandbox-explainer.html`](docs/sandbox-explainer.html), [`docs/north-star.html`](docs/north-star.html) | interactive pages explaining the build |
| [`deploy/argocd`](deploy/argocd) | the app-of-apps entry |
| `sandbox-runtime/` | upstream, as a submodule pinned to the commit the design was read against |

## How it holds

```
phone / browser ──Remote Control relay──▶ pod (hostUsers:false, uid 1000, no caps, read-only root)
                                            └─ srt (proxy allowlist, write roots, seccomp)
                                                 └─ bubblewrap (own mount/net/pid namespaces)
                                                      └─ claude remote-control  |  ant beta:worker
CiliumNetworkPolicy: DNS + TCP/443 to the same allowlist, nothing else; no ingress.
```

## Quick start on another cluster

```bash
helm install cs oci://ghcr.io/paimonsoror/charts/claude-sandbox --version 0.1.0 \
  -n claude-sandbox --create-namespace --set image.tag=sha-<short>
kubectl -n claude-sandbox exec -it deploy/cs-claude-sandbox-homelab -- claude auth login
kubectl -n claude-sandbox attach -it deploy/cs-claude-sandbox-homelab   # answer "Enable Remote Control? y"
```

Requirements and values are in the [chart README](charts/claude-sandbox/README.md).
