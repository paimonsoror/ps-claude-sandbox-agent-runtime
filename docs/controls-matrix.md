# Controls matrix: this build against published agent-sandbox controls

How the homelab sandbox lines up with controls that are published and citable, what is still a
gap, and what an enterprise port would need to keep each control. ADR-0013 records the
decisions this matrix drove. Sources were read on 2026-10-26; the IDs are ours, the statements
are the sources' (quoted or closely paraphrased), the URLs are in the
[source list](#sources).

Status: **Met** (implemented and verifiable here), **Partial** (implemented with a stated
residual), **Gap** (not implemented; listed in the plan or as enterprise work), **N/A**.

## 1. Filesystem access

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| OWASP-SAAG-3.2.3b | "read-only filesystem where possible" inside the sandbox | Pod root filesystem read-only; srt `allowWrite` limited to `/workspace`, `/home/agent`, `/tmp` (ADR-0008, ADR-0005) | Met | Same; add a PSS/admission rule that rejects `readOnlyRootFilesystem: false` |
| OWASP-SAAG-9.2b | "Limit file system access using mount namespaces and read-only volumes. Inject ephemeral storage (e.g., tmpfs)" | bubblewrap mount namespace per command; `/tmp` and `/mnt/memory` are emptyDirs | Met | Same; consider `emptyDir.medium: Memory` for session scratch |
| ANTH-SRT-01 / ANTH-CC-SBX-01 | Mandatory write denies on `.git/hooks`, `.git/config`, `.mcp.json`, `.claude/commands`, `.claude/agents`, shell rc files; Linux deny list built at launch, nested repos created later not covered | srt default behaviour, strict mode (ADR-0005) | Partial: repositories cloned *during* a session below depth 3 are not re-scanned | Pre-clone repositories before the wrap starts (entrypoint does this for `repo`); raise `mandatoryDenySearchDepth`; restart the wrap after bulk clones |
| ANTH-MA-06 | "mount only the directories your tools require" | Worker mounts `/workspace`, home, `/tmp`, `/mnt/memory`, two read-only ConfigMaps | Met | Same |
| CODEX-02 | Config directories inside writable roots stay read-only | Same set as ANTH-SRT-01 | Met | Same |
| NIST-800-190-4.5.5 | "In no case should containers be able to mount sensitive directories on a host's file system" | No `hostPath`; only PVC, emptyDir, ConfigMap volumes (PSS *restricted* volume set) | Met | Enforce with PSA `restricted` on volume types (ours would fail only on `procMount`, see §4) |
| PSS-R-01 | Restricted volume types only | As above | Met | Same |
| DOCKER-SBX-04 | Host-mounted workspaces let edits to hooks/CI land on the host | Workspace is a PVC the pod owns, never a host checkout | Met | Same; review `git push` targets instead |

## 2. Network egress

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| ANTH-ENG-02 / ANTH-CC-SBX-03 | All traffic through a proxy outside the sandbox enforcing a domain allowlist; network namespace with no route out; `strictAllowlist` | srt strict mode with `strictAllowlist: true` (ADR-0006) | Met | Same |
| ANTH-CC-SBX-04 | Proxy decides on client-supplied hostname; domain fronting possible; "configure a custom proxy that terminates TLS and inspects traffic" for stronger guarantees | Not terminated; allowlist is names only | Partial (documented residual) | TLS-terminating egress proxy with inspection (srt `tlsTerminate` + enterprise CA, or an OpenShell-style L7 middleware); block CONNECT to IP literals |
| ANTH-SRT-02 | `deniedResolvedAddresses`: refuse allowed names that resolve to denied ranges | RFC 1918 + CGNAT ranges denied in every srt settings file | Met | Add the enterprise's own ranges and metadata endpoints |
| OWASP-SAAG-9.1 | "restrict ingress/egress by default", "Prevent direct internet access unless explicitly needed (and monitor it)" | CiliumNetworkPolicy: ingress none; egress DNS + TCP/443 to the allowlisted FQDNs only (ADR-0006) | Met (monitoring: see §7) | Same; FQDN policy or an egress gateway per sensitivity tier (NIST-800-190-4.3.3) |
| NIST-800-190-4.4.2 | "control the egress network traffic sent by containers"; app-aware filtering | Two layers: name allowlist in srt, FQDN policy at the CNI | Met | Add L7 inspection (see SBX-04) and flow logs to SIEM (Hubble is already present) |
| K8S-AGS-02 / GKE-AS-01 | "Network traffic between Sandboxes must be blocked by default"; default-deny posture | Ingress denied on every sandbox pod; egress cannot reach cluster CIDRs | Met | Same |
| DOCKER-SBX-03 / DAYTONA-01 | Deny-by-default outbound; over-broad wildcards flagged | Default base list is one host; wildcards limited to `*.github.com`, `*.githubusercontent.com`, `*.npmjs.org` | Partial: `github.com` is still an exfiltration channel (ANTH warning) | Scope the GitHub token instead of the host (§3); or route git through a credential proxy that allows only approved repositories |
| ANTH-CC-SBX-05 | UDP, QUIC, ICMP cannot leave the sandbox | bubblewrap network namespace removed; CNI policy allows only TCP/443 and DNS | Met | Same |
| CODEX-04 | Loopback/private binding blocked; DNS/IP checks best-effort | Linux sandbox localhost is private to the command; `deniedResolvedAddresses` covers private ranges | Met | Same |

## 3. Credentials and secrets

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| NIST-800-190-4.1.4 | "Secrets should be stored outside of images and provided dynamically at runtime"; only to containers that need them | No secret in the image or chart; Secrets referenced by name; worker key via `envFrom` only on the worker (ADR-0007) | Met | Same; source from the secrets manager through ESO (template shipped) |
| ANTH-MA-03 | Environment key "in a secrets manager, not in environment files or sandbox images"; rotate on suspicion | Hand-created Secret in v1; ExternalSecret from Vault optional | Partial | Make the ExternalSecret path mandatory; rotation runbook tied to the secrets manager |
| ANTH-MA-05 | Per-session secret only into the sandbox serving that session; never logged | v1 always-on worker: `ant` holds it in process; no per-session sandbox (ADR-0010) | Partial | Per-session Jobs with a per-Job Secret (plan phase 6) |
| OWASP-SAAG-3.2.8 | JIT, ephemeral credentials instead of long-lived static ones | claude.ai login is a refreshing OAuth credential; GitHub PAT is static | Partial | GitHub App installation tokens minted per session; Workload Identity Federation for Anthropic access |
| ANTH-CC-SEC-03 / DOCKER-SBX-02 / DAYTONA-02 | Credential proxy: raw credentials never enter the sandbox; attached at the boundary | Not implemented: the login file and the GitHub token are readable by the wrapped process | Gap (accepted for a single owner) | srt `credentials.envVars`/`files` with `mode: mask` behind `tlsTerminate`, or an OpenShell-style credential driver |
| ANTH-CC-SBX-02 | `denyRead` / `credentials.files` for secret material the command does not need | `/etc/srt` and `/etc/claude-code` read-denied; nothing else mounted | Met | Same |
| K8S-AGS-03 | "Sandbox Pods must not have access to the K8s API by default" | `automountServiceAccountToken: false`, no RBAC | Met | Same |
| OWASP-LLM06-05 | Execute tools in the user's context with minimal scopes | Login is the owner's own subscription; PAT scoped to named repositories | Met | Per-user identities, no shared accounts |

## 4. Process and kernel isolation

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| OWASP-SAAG-3.2.3a | Execute LLM-generated code in isolated environments: containers, VM/microVM, Wasm, cloud sandboxes | Pod + bubblewrap (containers inside a container) | Met at container level | microVM substrate (Kata, Firecracker, libkrun) via `isolation.runtimeClassName`; see the north star page |
| OWASP-SAAG-9.2a | Own namespace/container per agent; "AppArmor/SELinux or seccomp profiles to restrict syscalls" | Per-pod namespaces plus bubblewrap namespaces; srt's seccomp filter on every sandboxed command; **container-level AppArmor and seccomp are `Unconfined`** (ADR-0003) | Partial: profile moved from the container layer to the srt layer | Author a `Localhost` seccomp profile that allows the namespace syscalls bwrap needs and a matching AppArmor profile with `userns`, delivered by a node DaemonSet or the security-profiles-operator |
| NIST-800-190-4.4.3 | SELinux/AppArmor in all container deployments; default seccomp at minimum | As above | Partial | Same as above |
| PSS-B-03 / PSS-R-03 | Baseline: `procMount` Default, seccomp not Unconfined; Restricted: seccomp `RuntimeDefault`/`Localhost`, drop ALL | `procMount: Unmasked`, seccomp/AppArmor Unconfined; drop ALL, non-root, no privilege escalation | Gap against *baseline* and *restricted* on three fields (ADR-0003) | Either a sandboxed RuntimeClass (gVisor/Kata) so srt can run in weak mode inside a *restricted*-compliant pod, or a namespace-scoped PSA exemption plus `ValidatingAdmissionPolicy` pinning exactly these three fields |
| K8S-USERNS-01 | `hostUsers: false`: root in the container is not root on the host; capabilities namespaced | On, verified (`uid_map 0 2889613312 65536`) | Met | Same; it is the compensating control for the PSS gap |
| K8S-USERNS-02 | PSA relaxes `runAsNonRoot`/`runAsUser` with user namespaces; `procMount` relaxed under *baseline* only | We also set `runAsNonRoot: true` and uid 1000 | Met | Same |
| ANTH-CC-SBX-07 | `enableWeakerNestedSandbox` and `allowNestedUserNamespaces` weaken the boundary | Both off by default; weak mode is an explicit values flag | Met | Admission rule forbidding the flag unless `runtimeClassName` is a sandboxed runtime |
| ANTH-CC-SBX-06 | Unix sockets blocked; never expose the Docker socket | srt seccomp blocks Unix sockets; no socket mounted | Met | Same |
| ANTH-CC-SBX-09 / ANTH-CC-SEC-01 | Bound MCP servers, hooks and file tools too: run the whole process under srt, a container or a VM; never bypass permissions as root | Whole process under srt inside a pod, non-root; `bypassPermissions` disabled by managed settings (ADR-0005) | Met | Same |
| K8S-AGS-01 | "Untrusted code inside a Sandbox Pod must not be able to compromise the node or host kernel" (gVisor/Kata) | Shared host kernel; defence is user namespace + bubblewrap + seccomp | Partial: kernel is shared | Sandboxed RuntimeClass per pod |
| DOCKER-SBX-01 / E2B-01 / MSFT-ACA-01 | Separate kernel per sandbox | Not available on one bare-metal node without nested virt or a second node | Gap (platform) | Kata (QEMU/Cloud Hypervisor) or libkrun microVMs on nodes with KVM |

## 5. Identity and authorisation

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| OWASP-LLM06-01/03/04 | Minimise extensions and their permissions; avoid open-ended tools | Claude Code with its standard toolset; shell is inherently open-ended, bounded by the sandbox instead | Partial (by design of the product) | `permissions.deny` rules and MCP allowlists in managed settings; tool catalog governance |
| OWASP-LLM06-07 / OWASP-LLM05-01 | Complete mediation downstream; treat the model as an untrusted user | The sandbox never holds cluster credentials; GitHub enforces branch protection on the owner's repos | Met for what is reachable | Same, plus policy on every downstream API |
| OWASP-ASI-T03 / T09 | Granular permissions; no cross-agent privilege delegation; trust boundaries | One identity per sandbox kind; worker and workspace cannot reach each other | Met | One environment and workspace per trust boundary (ANTH-MA-04) |
| ANTH-CC-SBX-08 / CODEX-06 | Central, non-overridable policy (managed settings, MDM) | `/etc/claude-code/managed-settings.json` baked by the chart: sandbox keys, `disableBypassPermissionsMode`, `forceLoginMethod` | Met in-pod | Server-managed settings from the Claude admin console; `allowedProviders`, `forceLoginOrgUUID` |
| K8S-AGS-05 | RBAC on sandbox CRDs; rate limits at the gateway | No CRDs yet; no ingress | N/A in v1 | Arrives with the control plane (ADR-0015) |
| NIST-800-190-4.3.2 | Cluster admin access tightly controlled, MFA, audited | Single-owner cluster, SSH key + sudo | Partial | SSO/MFA on the API server (Authentik is available), audit logging to SIEM |

## 6. Supply chain and image

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| NIST-800-190-4.1.5 | Trusted registries only; validate image signatures before execution | Image built by CI from a Dockerfile with pinned versions; pulled by immutable `sha-` tag | Partial: not signed, not verified at admission | Sign with cosign in the workflow; verify with Kyverno/sigstore policy-controller; private registry mirror |
| OWASP-ASI-T17 / OWASP-SAAG-6.1.2 | Signed artifacts, SBOM, restrict untrusted tool installs, lockfiles | npm pins for srt and Claude Code; `ant` from a tagged release; no SBOM | Partial | SBOM generation (syft) attached to the image; dependency review on the Dockerfile |
| ANTH-MA-01 | Operator owns image hardening: drop capabilities, non-root, read-only root | All three | Met | Same |
| NIST-600-1-GV-6.1-007 | Inventory of third-party providers | Anthropic (API, Remote Control relay, Managed Agents), GitHub, npm registry, listed in ADR-0006 | Met (documented) | Formal vendor inventory |

## 7. Observability and audit

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| OWASP-ASI-T02 / ATLAS-M0024 | Execution logs of tool calls; log tool use, data access, installs, agent identity | Claude Code transcripts on the home PVC; pod stdout to Loki; srt denials visible with `debug.srt` (ADR-0012) | Partial: not centralised by default, not immutable | OpenTelemetry export from Claude Code to the collector; `ConfigChange` hooks; append-only log store |
| OWASP-ASI-T08 / OWASP-SAAG-9.4 | Cryptographically signed, immutable, per-action logs with agent and session ids | Not implemented | Gap | Signed log pipeline (e.g. Loki with object-lock storage, or a transparency log) |
| OWASP-SAAG-3.3.1 | Observe sandbox execution for forbidden actions | srt reports proxy denials and filesystem violations; Hubble flow logs for the CNI layer | Partial (needs `debug.srt` or Hubble) | Always-on structured violation export; alerts on denial spikes |
| ANTH-CC-SEC-02 | Monitor through OpenTelemetry metrics; audit settings changes | Not enabled | Gap | `CLAUDE_CODE_ENABLE_TELEMETRY` + OTLP to the existing collector |
| NIST-800-190-4.5.4 | Audit OS authentication and privilege escalation | Node-level, unchanged | Partial | Node audit to SIEM |
| CSA-RT-4.12 | Logs usable for forensics while protecting PII | Loki retention as configured cluster-wide | Partial | Retention and redaction policy for session content (ANTH-MA-07) |

## 8. Human oversight and approval

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| OWASP-LLM06-06 / ATLAS-M0029 | Human approval for high-impact actions | Remote Control sessions prompt the owner; `bypassPermissions` cannot be enabled; permission mode per workspace | Met for workspaces | Approval workflows with a second person for production-affecting tools |
| ATLAS-M0030 | Block or confirm tool invocation once untrusted data enters context | Claude Code's permission system and auto-mode classifier are available; not forced | Partial | `permissions.defaultMode` and ask-rules by policy |
| OWASP-ASI-T11 / NIST-600-1-MS-2.6-004 | Review generated code with elevated privileges | Nothing inside the sandbox has elevated privileges; code leaves only through PRs | Met by construction | Branch protection + required review on every target repository |
| CODEX-03 | Fail-closed reviewer | Not applicable to Claude Code | N/A | — |

## 9. Data handling and retention

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| ANTH-MA-07 | Operator retains, redacts or deletes session content; cleans leftover memory copies | Memory stores on an emptyDir; transcripts on the home PVC; no retention policy | Partial | Retention schedule; PVC wipe on offboarding; redaction before export |
| OWASP-LLM02-03/04 | Least privilege on data the model can reach | Only the cloned repositories and what the allowlist serves | Met | Data classification per workspace |

## 10. Resource limits

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| OWASP-SAAG-5-CodeExec / K8S-AGS-04 | CPU, memory, time limits; LimitRanges | Requests and limits per sandbox; emptyDir size limits | Met (no LimitRange yet) | `LimitRange` and `ResourceQuota` in the namespace |
| OWASP-ASI-T04 / CSA-RT-4.10 | Quotas and rate limits per session | Remote Control `--capacity`; no API rate limits | Partial | Gateway-level rate limits when a control plane fronts the sandboxes |

## 11. Lifecycle and ephemerality

| ID | Control (source) | This build | Status | Enterprise port |
|---|---|---|---|---|
| OWASP-SAAG-5-OS / 9.3 | Sandbox "should not accumulate data and sessions"; clear memory on session end | Workspaces are long-lived by design; worker sessions share `/workspace` (ADR-0010) | Gap for the worker | Per-session pods with fresh volumes (plan phase 6); warm pools with claims (ADR-0015) |
| ANTH-CC-SEC-04 | Session VMs reclaimed after inactivity | Not applicable to long-lived workspaces | N/A / Gap | Idle timeout and scheduled deletion in the control plane |
| NIST-600-1-GV-1.7-001 | Deactivation protocol | Scale the Deployment to zero or disable the entry in git; key revocation in the Console | Met | Documented kill switch with an owner |

## Scorecard

| Domain | Met | Partial | Gap | N/A |
|---|---|---|---|---|
| Filesystem | 7 | 1 | 0 | 0 |
| Network | 7 | 2 | 0 | 0 |
| Credentials | 4 | 3 | 1 | 0 |
| Process/kernel | 6 | 3 | 2 | 0 |
| Identity | 3 | 2 | 0 | 1 |
| Supply chain | 2 | 2 | 0 | 0 |
| Observability | 0 | 4 | 2 | 0 |
| Human oversight | 2 | 1 | 0 | 1 |
| Data handling | 1 | 1 | 0 | 0 |
| Resources | 1 | 1 | 0 | 0 |
| Lifecycle | 1 | 0 | 1 | 1 |

Reading: the build is strong where the sandbox runtime and Kubernetes give controls for free
(filesystem, egress, no cluster credentials, non-root, user namespaces). The gaps cluster in
three places an enterprise cares about and a single owner can defer: **a separate kernel per
sandbox**, **credentials that never enter the sandbox**, and **signed, centralised audit
logs**. The north-star page covers the first; ADR-0013 lists all three as the port's
prerequisites.

## Sources

OWASP Top 10 for LLM Applications 2025 (genai.owasp.org/llm-top-10), OWASP Agentic AI Threats
and Mitigations v1.1, OWASP Securing Agentic Applications Guide v1.0; Anthropic: "Beyond
Permission Prompts" engineering post, Claude Code Sandboxing / Sandbox environments / Security
docs, sandbox-runtime README, Managed Agents self-hosted sandboxes security model; NIST SP
800-190, NIST AI 600-1; CSA Agentic AI Red Teaming Guide and MAESTRO; Kubernetes Pod Security
Standards, user namespaces (v1.36 GA), kubernetes-sigs/agent-sandbox threat model, GKE Agent
Sandbox; OpenAI Codex agent approvals and security; Docker Sandboxes security; E2B enterprise;
Daytona isolation; MITRE ATLAS v6 (2026.09) mitigations M0024/M0028/M0029/M0030/M0032/M0037.
CIS Kubernetes Benchmark and Microsoft guidance were read through secondary sources only.
