# Runbook: claude-sandbox on the homelab

Operations for the sandboxes the chart deploys. Namespace `claude-sandbox`; the workspace
Deployment is `claude-sandbox-homelab`, the worker is `claude-sandbox-worker`. All `kubectl`
below runs on the node as `sudo -n k3s kubectl`, or from any kubeconfig with access.

## Roll out or change

Everything is a PR to `homelab-charts` (the Application entry) or to
`ps-claude-sandbox-agent-runtime` (chart or image). After a merge the `argocd-sync-watcher`
CronJob syncs within about two minutes. To hurry it:

```bash
kubectl -n argocd annotate application argocd-apps argocd.argoproj.io/refresh=hard --overwrite
kubectl -n argocd patch application claude-sandbox --type merge -p '{"operation":{"sync":{}}}'
kubectl -n argocd get application claude-sandbox -o jsonpath='{.status.sync.status} {.status.health.status}{"\n"}'
```

| Change | Where | Then |
|---|---|---|
| new image (srt, Claude Code or `ant` version) | bump a build arg in `images/claude-sandbox/Dockerfile`, merge, read the `sha-` tag from the workflow summary | PR to homelab-charts setting `image.tag` |
| chart change | edit `charts/claude-sandbox`, bump `version` in `Chart.yaml`, merge, push tag `chart-v<version>` | PR to homelab-charts setting `targetRevision` |
| allowlist or sandbox list | edit the `helm.values` block in the Application entry | merge |

`tools/bump.py` in homelab-charts handles both pins (`--kind chart` and `--kind image`).

## First start of a workspace

```bash
kubectl -n claude-sandbox logs -f deploy/claude-sandbox-homelab
#   [sandbox-entrypoint] cloning ... into /workspace
#   [sandbox-entrypoint] waiting for a claude.ai login at /home/agent/.claude/.credentials.json ...
kubectl -n claude-sandbox exec -it deploy/claude-sandbox-homelab -- claude auth login
#   open the printed URL on the laptop, approve, paste the code back
kubectl -n claude-sandbox exec deploy/claude-sandbox-homelab -- claude auth status; echo $?   # 0
kubectl -n claude-sandbox attach -it deploy/claude-sandbox-homelab
#   "Enable Remote Control? (y/n)" -> y ; detach with Ctrl-P Ctrl-Q (never Ctrl-C)
```

The session then appears at claude.ai/code and in the Claude app as `homelab-<adjective>-<animal>`.
Both answers are remembered on the home volume; a pod restart does not ask again.

## Login expired

Symptom: the app shows the session offline or the server log says the login expired; `claude
auth status` exits non-zero. Claude Code warns three days before expiry inside sessions.

```bash
kubectl -n claude-sandbox exec -it deploy/claude-sandbox-homelab -- claude auth login
kubectl -n claude-sandbox rollout restart deploy/claude-sandbox-homelab
```

## Server exited after a network outage

Remote Control server mode gives up after about ten minutes without the relay and exits; the
liveness probe or the container exit restarts the pod, which resumes with the stored login. If
sessions are missing from the list afterwards, start a new one from the app; the old ones are
in the archived list for about four hours.

## Rotate the Managed Agents environment key

1. Console: revoke the key on the environment, generate a new one.
2. `kubectl -n claude-sandbox create secret generic claude-sandbox-managed-agents --from-literal=ANTHROPIC_ENVIRONMENT_ID=env_... --from-literal=ANTHROPIC_ENVIRONMENT_KEY=... --dry-run=client -o yaml | kubectl apply -f -`
3. `kubectl -n claude-sandbox rollout restart deploy/claude-sandbox-worker`
4. From the laptop: `ant beta:environments:work stats --environment-id env_...` shows `workers_polling: 1`.

With `externalSecrets.enabled`, change the value in Vault instead and wait for the refresh
interval (1 h) or delete the Secret to force it.

## Read what the sandbox denied

Denials are only logged with `debug.srt: true` (chatty; it prints the commands). Turn it on in
the Application values for a day, then:

```
{namespace="claude-sandbox"} |~ "blocked|denied|violation|Operation not permitted"
```

Hubble shows CNI drops without any change:

```bash
kubectl -n cilium exec ds/cilium -- hubble observe --namespace claude-sandbox --verdict DROPPED --last 50
```

## Widen or narrow the allowlist

Edit `allowedDomains` for the sandbox in the Application values. One list feeds both srt and the
Cilium policy, so a name that is missing fails at the proxy (HTTP 403 inside the sandbox) and a
name that is present but whose IP is private fails with "resolved to a private address".
Prefer `host:443` entries over wildcards; never add a cluster or LAN name.

## Recover a stuck workspace

```bash
kubectl -n claude-sandbox describe pod -l claude-sandbox/name=homelab | tail -30
kubectl -n claude-sandbox logs deploy/claude-sandbox-homelab --previous
kubectl -n claude-sandbox rollout restart deploy/claude-sandbox-homelab
```

To inspect the volumes without the server running, `kubectl exec` into the pod: the exec
shell runs outside bubblewrap but inside the pod's boundary (uid 1000, read-only root, same
network policy). A separate debug pod cannot mount the PVCs while the sandbox pod holds them
(ReadWriteOnce); scale the Deployment to zero first if that is needed.

## Stop everything

Set `enabled: false` on the Application entry (keeps PVCs) or scale to zero:

```bash
kubectl -n claude-sandbox scale deploy --all --replicas=0
```

Revoke the environment key in the Console and run `/logout` in a session (or delete
`/home/agent/.claude/.credentials.json`) to cut credentials.

## Monthly

- Check `npm view @anthropic-ai/sandbox-runtime version`, `npm view @anthropic-ai/claude-code version`
  and the `anthropics/anthropic-cli` releases; bump the Dockerfile args.
- Read the controls matrix rows marked Partial for anything upstream has since closed.
