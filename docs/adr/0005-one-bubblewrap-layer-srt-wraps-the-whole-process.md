# 0005. One bubblewrap layer: srt wraps the whole process

Date: 2026-10-26
Status: Accepted

## Context

Claude Code has two ways to use the sandbox runtime:

- The built-in **Bash sandbox** (`sandbox.enabled` in settings): each shell command Claude runs
  is wrapped individually. File tools, MCP servers, hooks, LSP servers and `apiKeyHelper` run
  outside it. `claude remote-control` honours the setting for the sessions it serves (the
  `--sandbox` flag was removed in v2.1.300; "to sandbox sessions, set sandbox.enabled to true
  in settings").
- **Wrapping the whole process** (`srt claude ...`): everything Claude Code starts, including
  MCP servers and hooks, is inside one boundary. Anthropic's sandbox-environments guide lists
  this as the option that "isolates MCP servers and hooks as well as Bash, without Docker".

Stacking both means bubblewrap inside bubblewrap. srt's seccomp layer refuses nested user
namespaces by default; allowing them (`allowNestedUserNamespaces: true`) is documented as
"treat `denyWrite` and the mandatory denies as not holding against any command run under it".
So the inner sandbox can only exist by weakening the outer one.

For the Managed Agents worker there is no inner option at all: `ant` has no sandbox of its own.

## Decision

The **outer boundary is srt wrapping the whole process** for every sandbox kind:

- workspace: `srt --settings /etc/srt/settings.json -- claude remote-control ...`
- worker: `srt --settings /etc/srt/settings.json -- ant beta:worker poll ...`

Claude Code's inner Bash sandbox is **off** inside the workspace
(`sandbox.enabled: false` in the managed settings file, with a comment naming this ADR). The
outer settings keep `allowNestedUserNamespaces: false`.

The chart exposes `isolation.wrap: srt | claude-bash-sandbox`. The second value drops the outer
srt and turns the inner sandbox on with `failIfUnavailable: true` and
`allowUnsandboxedCommands: false`; it exists for comparison and for images where the whole-process
wrap is not wanted, and is not the default.

Claude Code's `permissions.disableBypassPermissionsMode: "disable"` stays set so a session cannot
switch to `bypassPermissions`; the user approves tool calls from the phone or picks
`acceptEdits` / `auto` per workspace via `--permission-mode`.

## Consequences

- MCP servers and hooks a repository ships are inside the boundary. A malicious `.mcp.json` in a
  cloned repository cannot reach the network except through the allowlist, and cannot write
  outside `/workspace`, the home volume and `/tmp`.
- srt's mandatory denies protect `.claude/commands`, `.claude/agents`, `.mcp.json`,
  `.git/hooks`, `.git/config` and shell rc files at the sandbox root and three levels down at
  launch time; files created later by `git clone` deeper in the tree are not re-scanned (upstream
  limitation, documented in the plan's verification step).
- Everything Claude Code writes must be inside `allowWrite`: `/workspace`, `/home/agent`
  (`.claude`, `.claude.json`, `.npm`, `.config`), `/tmp` (`CLAUDE_CODE_TMPDIR=/tmp/claude`).
- Violations surface in srt's debug log rather than in Claude's transcript; the per-command
  `<sandbox_violations>` annotation that the inner sandbox provides is lost. ADR-0012 covers
  how to read them.

## Alternatives considered

- **Inner Bash sandbox only** (no srt wrap): the documented default for laptops; rejected because
  MCP servers, hooks and file tools would run with the pod's full reach.
- **Both layers with `allowNestedUserNamespaces: true`**: the inner layer is what Claude Code
  would annotate violations with, but the outer layer's write denies stop holding; the stronger
  single layer wins.
- **`CLAUDE_CODE_PROCESS_WRAPPER` pointing at srt**: covers only processes Claude Code starts
  from its own binary (background agents, Remote Control session processes), not the server we
  start ourselves, and the launcher contract expects an `exec` into Claude Code, which srt does
  not do. Not documented for srt; not used.
