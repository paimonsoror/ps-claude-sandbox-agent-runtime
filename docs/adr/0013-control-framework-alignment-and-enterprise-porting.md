# 0013. Control framework alignment and enterprise porting

Date: 2026-10-26
Status: Accepted

## Context

The owner asked that the design be measured against the controls the industry has published for
agent sandboxing (filesystem access, remote server access, credentials, isolation, audit) and
that the documentation say what keeping those controls would take in a larger enterprise
environment. The sources that publish concrete, testable controls are: OWASP (Top 10 for LLM
Applications 2025, Agentic AI Threats and Mitigations v1.1, Securing Agentic Applications
Guide), Anthropic (Claude Code sandboxing and security docs, the sandbox-runtime README, the
Managed Agents self-hosted security model), NIST SP 800-190 and AI 600-1, the Cloud Security
Alliance red-teaming guide, Kubernetes Pod Security Standards and the agent-sandbox threat
model, MITRE ATLAS mitigations, and the published security models of commercial agent sandboxes
(Codex, Docker Sandboxes, E2B, Daytona). The full mapping is
[`../controls-matrix.md`](../controls-matrix.md).

## Decision

1. **The matrix is a maintained artifact.** Every ADR that changes a boundary updates the rows
   it affects. A row may say *Gap*; it may not be silently absent.
2. **Three gaps are accepted for the homelab and named as the enterprise prerequisites:**
   - *Separate kernel per sandbox.* The homelab shares one kernel across a user namespace,
     bubblewrap and seccomp. An enterprise port runs each sandbox pod under a sandboxed
     `RuntimeClass` (gVisor or Kata/microVM), which the chart already accepts through
     `isolation.runtimeClassName` together with `isolation.mode: weak`, and which also
     restores Pod Security Standard *restricted* compliance (no `procMount: Unmasked`, no
     unconfined profiles).
   - *Credentials never inside the sandbox.* The homelab lets the wrapped process read its own
     login and the GitHub token. An enterprise port brokers credentials at the boundary: srt's
     `credentials` masking behind `tlsTerminate` with an enterprise CA, or an external
     credential proxy, plus short-lived GitHub App tokens and Workload Identity Federation for
     Anthropic access.
   - *Signed, centralised audit.* The homelab has Loki and transcripts on a volume. An
     enterprise port exports Claude Code telemetry over OTLP, ships srt and Hubble denials as
     structured events, and stores them append-only with retention and redaction policy.
3. **Controls that must survive the port unchanged** (they are what makes the design hold):
   `hostUsers: false`, non-root uid, all capabilities dropped, read-only root filesystem, no
   ServiceAccount token, srt strict mode with `strictAllowlist`, the single domain list rendered
   into both the proxy and the CNI policy, `deniedResolvedAddresses` for private ranges,
   mandatory write denies on configuration paths, `bypassPermissions` disabled, no ingress.
   An enterprise deployment enforces them with admission policy (`ValidatingAdmissionPolicy`
   or Kyverno) rather than trusting the chart.
4. **Central policy delivery.** In the enterprise the managed settings come from the Claude
   admin console (server-managed settings) or MDM, not from the image, and `allowedProviders`,
   `forceLoginOrgUUID` and `network.allowManagedDomainsOnly` are set there.
5. **Tenant isolation per trust boundary** follows Anthropic's guidance: one environment and
   workspace per trust boundary, one namespace per tenant with its own policy and quotas, and
   per-session sandboxes (ADR-0010 v2) so sessions never share a filesystem.

## Consequences

- The matrix gives the owner a defensible answer to "how does this compare" with a status per
  control and a named source, which is what a principal engineer or a security reviewer will
  ask for first.
- The three prerequisites shape the north-star architecture (ADR-0015): they are exactly what a
  control plane over microVM substrates with a credential-brokering policy layer provides.
- Some PSS rows will stay *Gap* on this hardware; the ADR says so instead of hiding it behind
  the compensating user-namespace control.

## Alternatives considered

- **Pick one framework** (for example only OWASP): the useful controls are spread across
  sources; a single one leaves kernel isolation or credential brokering unaddressed.
- **Claim PSS restricted via the user-namespace relaxation**: Kubernetes relaxes
  `runAsNonRoot` and `runAsUser` for user-namespace pods but still forbids `procMount:
  Unmasked` under *restricted*; the claim would be false.
