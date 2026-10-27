#!/usr/bin/env bash
# Entrypoint for the claude-sandbox image. Everything after the `exec` runs under srt.
# Kinds: workspace (Claude Code, Remote Control server mode), managed-agents-worker (ant),
# shell (sleep; for maintenance with kubectl exec).
set -euo pipefail

: "${SANDBOX_KIND:=workspace}"
: "${SANDBOX_NAME:=sandbox}"
: "${SANDBOX_WRAP:=srt}"              # srt | claude-bash-sandbox (ADR-0005)
: "${SRT_SETTINGS:=/etc/srt/settings.json}"
: "${HOME:=/home/agent}"
: "${CLAUDE_CODE_TMPDIR:=/tmp/claude}"

log() { printf '[sandbox-entrypoint] %s\n' "$*"; }

# The home volume may be empty on first start.
mkdir -p "$HOME/.claude" "$HOME/.config" "$CLAUDE_CODE_TMPDIR"
if [ ! -s "$HOME/.claude.json" ]; then
  echo '{}' > "$HOME/.claude.json"
fi
# Pre-trust /workspace so the server does not stop on the trust prompt (ADR-0007; documented
# field projects["<path>"].hasTrustDialogAccepted).
tmp="$(mktemp)"
jq '.projects["/workspace"].hasTrustDialogAccepted = true' "$HOME/.claude.json" > "$tmp" \
  && mv "$tmp" "$HOME/.claude.json"

# First start: clone the repository into the empty workspace volume. Runs outside srt but
# inside the pod, so the CNI egress policy still applies.
if [ -n "${WORKSPACE_REPO:-}" ] && [ -z "$(ls -A /workspace 2>/dev/null)" ]; then
  log "cloning ${WORKSPACE_REPO} into /workspace"
  git clone --recurse-submodules "${WORKSPACE_REPO}" /workspace
fi

# A GitHub token, when mounted, is handed to git through a credential helper that reads the
# environment, so the token is never written to disk.
if [ -n "${GITHUB_TOKEN:-}" ]; then
  git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'
  export GH_TOKEN="${GITHUB_TOKEN}"
fi
git config --global --add safe.directory /workspace >/dev/null 2>&1 || true

# srt covers the shell startup files it denies with empty, read-only mount-point files that
# exist for as long as the sandbox runs (README, "Write denies on paths that do not exist
# yet"). Keep them out of git status without touching the repository's tracked files.
if [ -d /workspace/.git ]; then
  mkdir -p /workspace/.git/info
  # The full mandatory-deny set: shell rc files, git config, .ripgreprc, .mcp.json, the IDE
  # directories and the Claude config directories (sandbox-runtime README).
  for f in .bashrc .bash_profile .profile .zshrc .zprofile .ripgreprc .gitconfig .gitmodules \
           .mcp.json .vscode .idea .claude/commands .claude/agents; do
    grep -qxF "$f" /workspace/.git/info/exclude 2>/dev/null || echo "$f" >> /workspace/.git/info/exclude
  done
fi

log "sandbox kind=${SANDBOX_KIND} wrap=${SANDBOX_WRAP} srt=$(srt --version 2>/dev/null || echo '?') claude=$(claude --version 2>/dev/null | head -1 || echo '?') ant=$(ant --version 2>/dev/null | head -1 || echo '?')"

wrap() {
  if [ "${SANDBOX_WRAP}" = "srt" ]; then
    exec srt --settings "${SRT_SETTINGS}" -- "$@"
  fi
  exec "$@"
}

case "${SANDBOX_KIND}" in
  workspace)
    cred="$HOME/.claude/.credentials.json"
    # Remote Control needs a full claude.ai login (not CLAUDE_CODE_OAUTH_TOKEN). Wait for it
    # instead of crash-looping; the login is a one-time `claude auth login` over kubectl exec.
    until [ -s "${cred}" ]; do
      log "waiting for a claude.ai login at ${cred}; run: kubectl exec -it <pod> -- claude auth login"
      sleep 30
    done
    args=(remote-control
      --spawn "${RC_SPAWN:-same-dir}"
      --capacity "${RC_CAPACITY:-8}"
      --permission-mode "${RC_PERMISSION_MODE:-default}"
      --remote-control-session-name-prefix "${RC_NAME_PREFIX:-${SANDBOX_NAME}}")
    if [ "${RC_VERBOSE:-false}" = "true" ]; then args+=(--verbose); fi
    cd /workspace
    log "starting claude ${args[*]}"
    wrap claude "${args[@]}"
    ;;
  managed-agents-worker)
    : "${ANTHROPIC_ENVIRONMENT_ID:?ANTHROPIC_ENVIRONMENT_ID is required}"
    : "${ANTHROPIC_ENVIRONMENT_KEY:?ANTHROPIC_ENVIRONMENT_KEY is required}"
    cd /workspace
    log "starting ant beta:worker poll for environment ${ANTHROPIC_ENVIRONMENT_ID}"
    wrap ant beta:worker poll --workdir /workspace \
      --log-format "${ANT_LOG_FORMAT:-json}" --max-idle "${ANT_MAX_IDLE:-60s}"
    ;;
  shell)
    log "maintenance mode: sleeping"
    exec sleep infinity
    ;;
  *)
    log "unknown SANDBOX_KIND=${SANDBOX_KIND}"
    exit 64
    ;;
esac
