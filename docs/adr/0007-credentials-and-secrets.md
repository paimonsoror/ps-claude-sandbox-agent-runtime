# 0007. Credentials and secrets

Date: 2026-10-26
Status: Accepted

## Context

Three credentials are involved, each with a different lifetime and blast radius:

| Credential | Needed by | Documented constraints |
|---|---|---|
| claude.ai login (subscription OAuth) | workspace, for inference and Remote Control | Remote Control "requires a full-scope login token"; `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` "can only make model requests, so it can't establish Remote Control sessions"; API keys are not supported for Remote Control. Stored at `~/.claude/.credentials.json` (mode 0600), refreshed while in use, warns three days before expiry. |
| Managed Agents environment key | worker | Scoped to one environment's work queue. Anthropic: "store it in a secrets manager, not in environment files or sandbox images; rotate immediately if you suspect exposure"; keep the org API key off the worker host. |
| GitHub token (optional) | workspace, for `git push` and `gh` | Fine-grained PAT scoped to the repositories the workspace clones. |

The cluster already has Vault CE, External Secrets Operator and the established convention of
hand-created Secrets outside git for bootstrap values.

## Decision

- **Workspace login lives on the Claude home volume**, produced once by an interactive
  `kubectl exec -it <pod> -- claude auth login` using the paste-code flow (the pod has no
  browser). No Anthropic credential is baked into the image, the chart or git. The entrypoint
  waits with a clear message until `.credentials.json` exists instead of crash-looping, and
  pre-seeds `projects["/workspace"].hasTrustDialogAccepted` in `~/.claude.json` so the server
  does not block on the trust prompt.
- **Worker environment key** comes from a Secret the chart does not create
  (`existingSecret`, keys `ANTHROPIC_ENVIRONMENT_ID` and `ANTHROPIC_ENVIRONMENT_KEY`), created
  by hand or, when wanted, by an ExternalSecret from the `courier-vault` store pattern. The
  chart ships an optional `ExternalSecret` template behind `secrets.externalSecrets.enabled`.
- **GitHub token** is optional, injected as `GITHUB_TOKEN`/`GH_TOKEN` from a Secret, and used
  through `gh auth` / git credential helper inside the sandbox. srt's credential masking
  (`credentials.envVars` with `mode: mask`) is not used in v1 because it requires TLS
  termination; the token's scope is the control.
- **Inside the sandbox**, srt denies reads of `/etc/srt` (the policy itself) and of
  `/run/secrets`-style mounts that the wrapped process does not need. The claude.ai credential
  file must stay readable by Claude Code, so it is protected by the proxy allowlist (only
  Anthropic hosts) rather than by a read deny.
- **No ServiceAccount token** is mounted (`automountServiceAccountToken: false`); the sandbox
  has no reason to talk to the Kubernetes API.

## Consequences

- A compromised workspace can spend the owner's subscription and act as the owner toward the
  allowlisted GitHub repositories. It cannot reach Vault, the API server or other namespaces.
- A compromised worker can poll its one environment's queue and post results; it cannot create
  sessions or read other environments. Rotating the key in the Console and updating the Secret
  is the recovery.
- The login expires if unused for long enough; the plan's runbook covers renewing it and the
  entrypoint's wait loop makes the symptom obvious in `kubectl logs`.
- When the enterprise port arrives, the same three slots map onto Workload Identity
  Federation / Console profiles for inference, a secrets manager for the environment key, and
  a GitHub App installation token instead of a PAT (ADR-0013).

## Alternatives considered

- **`ANTHROPIC_API_KEY` in the workspace**: simplest, but no Remote Control, and a static key
  with the organisation's full API scope inside the sandbox.
- **`claude setup-token`**: good for the worker-style, headless case; not usable for Remote
  Control. Kept as the credential for a future `agent-sdk` kind.
- **Baking a login into the image**: never.
