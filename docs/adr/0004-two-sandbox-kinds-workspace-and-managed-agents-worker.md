# 0004. Two sandbox kinds: Claude Code workspace and Managed Agents worker

Date: 2026-10-26
Status: Accepted

## Context

"A sandbox my Claude agents connect to" can mean four different things:

1. Claude Code itself running in the cluster, driven from the owner's devices.
2. A remote execution service (MCP) that the owner's laptop Claude Code calls to run commands.
3. Anthropic Managed Agents sessions whose tool calls run in the homelab through a self-hosted
   environment worker.
4. The owner's own Agent SDK applications running under srt.

The owner chose 1 and 3 for this iteration (2026-10-26).

## Decision

One chart, `claude-sandbox`, renders a list of **sandboxes**. Each entry has a `kind`:

- **`workspace`**: the image runs `srt -- claude remote-control` in server mode. Sessions are
  created and driven from claude.ai/code or the Claude mobile app; the pod never listens on the
  network. Each workspace has its own `/workspace` volume (optionally cloned from a git
  repository on first start) and its own Claude home volume. Spawn mode `worktree` gives each
  remote session its own git worktree.
- **`managed-agents-worker`**: the image runs `srt -- ant beta:worker poll --workdir /workspace`.
  It long-polls the environment's work queue over outbound HTTPS with the environment key and
  executes tool calls (bash, file tools, skills) inside the sandbox.

Both kinds share the pod security contract of ADR-0003, the egress model of ADR-0006 and the
image. They differ only in the command, the secrets they mount and the domains they need.

Deferred, with a place reserved in the values schema: `kind: mcp-gateway` (an MCP server that
runs each tool call under srt for remote Claude Code sessions) and `kind: agent-sdk` (a user
command under srt with the SDK installed).

## Consequences

- The chart's unit of scaling is "one more list entry", so a second workspace for another
  repository or a second worker for another Managed Agents environment is a values change.
- The two kinds have different trust boundaries: a workspace is driven by the owner in real
  time, a worker executes whatever a Managed Agents session asks. Anthropic's security model
  for self-hosted sandboxes puts image hardening, egress control, key storage and per-session
  isolation on us; ADR-0003, 0006, 0007 and 0010 answer those.
- Remote Control requires feature-flag fetching, so `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
  must stay unset in workspace pods; telemetry may still be disabled with `DISABLE_TELEMETRY`.

## Alternatives considered

- **Only an MCP gateway**: would serve the laptop workflow, but the owner's primary use is Claude
  Code itself, and an MCP exec service duplicates what Managed Agents' worker already provides.
- **Separate charts per kind**: more files, same pod contract; rejected while both kinds fit a
  short values entry.
