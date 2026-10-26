# 0008. Storage: local-path volumes, read-only root filesystem

Date: 2026-10-26
Status: Accepted

## Context

Pod user namespaces rely on idmapped mounts so files written by container uid 1000 appear with
the mapped host uid. On this cluster `local-path` provisions hostPath directories on the node's
ext4 NVMe, which supports idmapping on kernel 6.8. The cluster's other stateful apps use NFS
exports from the NAS, which Kubernetes documents as unsupported for user-namespace pods. The
spike confirmed ConfigMap and emptyDir volumes work in the user-namespace pod.

Claude Code writes under `~/.claude` (sessions, debug logs, credentials), `~/.claude.json`,
`~/.npm` and the project directory. srt creates mount-point files for write denies of paths that
do not exist yet, inside writable paths only. The Managed Agents worker downloads skills under
`<workdir>/skills` and mounts memory stores under `/mnt/memory`.

## Decision

Per sandbox:

| Mount | Backing | Size (default) | Purpose |
|---|---|---|---|
| `/workspace` | `local-path` PVC, RWO | 20 Gi (workspace), 10 Gi (worker) | repositories, build output, worker workdir |
| `/home/agent` | `local-path` PVC, RWO | 2 Gi | `.claude`, `.claude.json`, `.npm`, `.config`, login state |
| `/tmp` | `emptyDir` | 2 Gi limit | `CLAUDE_CODE_TMPDIR`, srt proxy sockets, scratch |
| `/mnt/memory` | `emptyDir` (worker only) | 1 Gi limit | Managed Agents memory store working copies |
| `/etc/srt`, `/etc/claude-code` | ConfigMap, read-only | | srt settings, Claude managed settings |

The container root filesystem is read-only. PVCs use `Retain`-like behaviour by being owned by
the Deployment's values entry, not by a StatefulSet: deleting a sandbox entry from values prunes
its Deployment, and the PVC is kept unless `persistence.keep: false`
(`helm.sh/resource-policy: keep`).

Backups are out of scope: the workspace is a clone of a repository that lives elsewhere, and the
login can be re-established in a minute.

## Consequences

- Workspaces are pinned to the single node by RWO local-path volumes, which matches the cluster.
- The owner's "never prune its PVC" lesson from TelltaleDNS is encoded as the keep annotation.
- Memory store copies are on an emptyDir, so a worker pod restart discards them; the worker
  syncs them back to Anthropic while running, and Anthropic's security note says cleanup of
  leftovers is ours, which an emptyDir handles by construction.

## Alternatives considered

- **NFS for `/workspace`**: shared with other hosts, but unsupported with user namespaces and
  slow for git; rejected.
- **StatefulSet**: gives stable PVC names, but a Deployment with `Recreate` strategy and named
  PVCs is simpler to prune per values entry.
- **Writable root filesystem**: convenient for `apt-get` experiments, but an escaped process
  could modify the entrypoint or the srt install; rejected, with `isolation.readOnlyRootFilesystem`
  kept as a toggle for debugging.
