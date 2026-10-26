# 0012. Operations and observability

Date: 2026-10-26
Status: Accepted

## Context

The cluster ships every container's stdout to Loki through fluent-bit and scrapes Prometheus
targets through ServiceMonitors. srt has no metrics endpoint; it reports violations on stderr
when `SRT_DEBUG=1` and, as a library, through `getViolationsForCommand`. `claude remote-control`
logs connection and session events (`--verbose` adds detail); `ant beta:worker` can log JSON.

Three things change under us and need a known cadence: the sandbox runtime (research preview,
"APIs and configuration formats may evolve"), Claude Code (frequent releases, Remote Control
needs a recent version), and `ant`.

## Decision

- **Logs**: stdout/stderr of every sandbox pod flow to Loki as they do for every pod. The worker
  logs JSON (`--log-format json`). Workspaces log the server's output; `--verbose` is a values
  toggle. `SRT_DEBUG=1` is a values toggle (`debug.srt`), off by default because it is chatty
  and prints the command lines Claude runs.
- **Violation visibility**: with `debug.srt` on, srt prints each proxy denial with its reason
  and each filesystem denial it observes. A Loki query saved in the Grafana folder `Claude
  sandbox` (`{namespace="claude-sandbox"} |~ "blocked|denied|violation"`) is the v1 dashboard.
  A Prometheus exporter is deferred until srt grows a structured channel.
- **Health**: no HTTP probe exists for either command. The workspace Deployment uses a liveness
  probe that checks the `claude` process is alive (`pgrep -f "claude remote-control"`); the
  worker uses `pgrep -f "ant beta:worker"`. Both restart the pod on failure, which also covers
  the server's documented exit after a long outage.
- **Resources**: requests 500 m CPU / 1 GiB, limits 4 CPU / 6 GiB per workspace by default
  (builds and tests run inside); worker 250 m / 512 MiB, limits 2 CPU / 4 GiB. Tunable per
  entry. One node, so no affinity.
- **Upgrades**: monthly check of the three pins (`srt`, Claude Code, `ant`) through
  `tools/bump.py`-style review; a Claude Code bump is also forced by Remote Control's minimum
  version notes. The image workflow rebuilds on a build-arg change; the tag roll is a PR.
- **Runbook** (in the plan): first login, renewing an expired login, rotating the environment
  key, reading violations, recovering a workspace whose server exited, widening an allowlist.

## Consequences

- Everything is observable through tools already in the cluster; nothing new to run.
- Debug logging is a conscious widening of what is written to Loki (commands and hosts), so it is
  off by default and documented as such.
- The `pgrep` liveness probe runs outside bubblewrap (it is the container's probe), so it needs
  `procps` in the image and a `/proc` that shows the process tree, which the unmasked `/proc`
  provides.

## Alternatives considered

- **Sidecar that tails srt's violation store**: srt keeps violations in memory of the wrapping
  process; there is no file to tail. Revisit if upstream adds one.
- **No probes**: a hung server would sit there until noticed from the phone.
