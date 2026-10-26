# North star: "an on-premise version of Google's control plane around substrate, with Lambda microVM and OpenShell as backend providers"

A principal engineer described the target in one sentence. This page unpacks each term from the
primary sources (read 2026-10-26), maps it against what this repository builds today, and
explains each difference and why it exists. The interactive version is
[`north-star.html`](north-star.html). ADR-0015 records the decision it leads to.

## 1. The terms

### "Google's control plane"

The Kubernetes SIG project **kubernetes-sigs/agent-sandbox** (Apache-2.0, v1.0.x, API
`agents.x-k8s.io/v1beta1`), which Google launched on GKE as the *Agent Sandbox* add-on. In its
own words it is "a sandbox orchestrator": "Users create a Sandbox custom resource, and the
controller manages the underlying runtime resources."

| Piece | What it does |
|---|---|
| `Sandbox` | "a declarative API for managing a single, stateful pod with a stable identity and persistent storage"; the controller handles creation, scheduled deletion, pausing and resuming |
| `SandboxTemplate` | reusable blueprint for sandboxes (image, runtime class, policies) |
| `SandboxWarmPool` | "a pool of pre-warmed Sandboxes that can be quickly allocated"; GKE quotes sub-second allocation |
| `SandboxClaim` | binds one session to one warm sandbox |
| Sandbox Router | "a small reverse proxy that fans HTTP traffic out to thousands of ephemeral agent sandbox pods" by `X-Sandbox-ID`, with pluggable auth, so there is no per-sandbox Service |
| `sandboxd` runtime API | versioned gRPC/REST contract (exec on 9090, files/probes on 8080) that any in-pod runtime can implement |
| SDKs | Go and Python clients |

GKE adds managed gVisor nodes, a `ValidatingAdmissionPolicy` that rejects a Sandbox without
`runtimeClassName: gvisor`, and *Pod Snapshots* (memory + filesystem checkpoint to object
storage, restored through a new claim).

### "substrate"

Two readings, both from Google:

1. **Generic**: the isolation layer underneath the control plane. agent-sandbox "delegates
   low-level container isolation to secure 'Sandbox Runtimes' (like gVisor or Kata Containers)"
   and selects them only through the Kubernetes `RuntimeClass` field. The project does not
   use the word *substrate*, *backend* or *provider* for this; `RuntimeClass` is the only
   substitution point.
2. **Literal**: **Agent Substrate on GKE** (github.com/agent-substrate/substrate, pre-1.0,
   private GA). It "builds on the capabilities of Agent Sandbox" and replaces pods-per-agent
   with *Actors* whose RAM and files are snapshotted to object storage and restored "onto a
   shared pool of warm Workers" in under a second, running under gVisor or Cloud Hypervisor
   microVMs.

Either way the sentence means: a declarative sandbox lifecycle API on top, and a swappable
isolation layer underneath.

### "Lambda microVM"

**AWS Lambda MicroVMs** (June 2026): "serverless compute environments that provide VM-level
isolation with full operating system capabilities... through Firecracker virtualization".
Lifecycle `create-microvm-image` (builds and snapshots the environment) → `run-microvm` →
dedicated HTTPS endpoint → `suspend`/`resume` → `terminate`, up to 8 hours, 16 vCPU / 32 GB,
public egress by default or a VPC egress connector. AWS positions it as "a managed sandbox
provider in self-hosted sandboxes for Claude Managed Agents": one Firecracker VM per session,
booted from a snapshot, the worker inside claims the session and posts tool results, the VM is
suspended or terminated afterwards; "Your Anthropic organization API key never reaches AWS
compute". Lambda itself cannot run on-premises; Firecracker, libkrun and Cloud Hypervisor can.

### "OpenShell"

**NVIDIA OpenShell** (Apache-2.0, 0.1.x, maintained by NVIDIA and Red Hat, "planned for
integration into Red Hat AI"): "the safe, private runtime for autonomous AI agents". Three
components: a **Gateway** ("the control plane: it owns API access, state, policy and settings
delivery, provider configuration, and relay coordination"), a **Supervisor** inside every
sandbox that "launches the agent as a restricted child process and enforces policy", and a CLI.
Isolation on Linux: one non-root identity with no capabilities, Landlock for the filesystem,
seccomp user-notification to stage network operations, a network fence that "denies all
workload egress except the protected connection to the supervisor". Policy: YAML with static
`filesystem_policy`/`landlock`/`process` and hot-reloadable `network_policies` that are
per-binary (hash-verified), deny-all by default, with L7 middleware and TLS inspection; a
*Policy Advisor* that lets the agent propose narrow rules for human review and a *Policy
Prover* that blocks auto-approval when a rule adds credentialed reach. Credentials: "The agent
never sees real credentials"; the supervisor injects them at the network boundary.
**Compute drivers** are a documented, capability-negotiated gRPC extension point: Docker,
Podman, Kubernetes, libkrun microVM. On Kubernetes, OpenShell *uses* agent-sandbox: its
driver "creates a `Sandbox` resource and a separate supervisor Pod". Red Hat demonstrated it
as the per-session sandbox for Claude Managed Agents, replacing Anthropic's `spawn.sh`.

## 2. The sentence, assembled

```
            ┌──────────────────────────────────────────────────────┐
  sessions  │  CONTROL PLANE  (agent-sandbox CRDs, templates,       │
  ───────▶  │  warm pools, claims, router, admission policy)        │
            └───────────────┬──────────────────────────────────────┘
                            │ RuntimeClass / compute driver
            ┌───────────────┴──────────────┐   ┌─────────────────────┐
            │  SUBSTRATE A: microVM        │   │ SUBSTRATE B: OpenShell│
            │  (Firecracker / libkrun /    │   │ supervisor in-sandbox │
            │   Kata; snapshot, suspend)   │   │ Landlock+seccomp+L7   │
            └──────────────────────────────┘   └─────────────────────┘
```

The control plane owns identity, lifecycle, warm capacity, routing and admission. The
substrates own what a session can touch while it runs. The two "providers" the PE names are
not peers: the microVM is a *where* (kernel boundary), OpenShell is a *what* (policy and
credential boundary inside the sandbox), and OpenShell can run *on* a microVM. Today no product
ships this combination on-premises as one thing: agent-sandbox has no provider abstraction
beyond `RuntimeClass`, Lambda MicroVMs is cloud-only, and OpenShell on Kubernetes sits on top
of agent-sandbox rather than underneath it.

## 3. What we built, next to it

| Layer | North star | This repository today | Why the difference |
|---|---|---|---|
| Sandbox lifecycle API | `Sandbox`/`SandboxTemplate`/`SandboxClaim`/`SandboxWarmPool` CRDs and a controller | A Helm chart that renders one long-lived Deployment per sandbox entry; no CRD, no warm pool, no claim | Two consumers, one owner, one node: a list in values is the simplest thing that works. The CRDs are the planned next layer (ADR-0015, plan phase 6) once per-session Managed Agents sandboxes are needed |
| Session routing | Sandbox Router by `X-Sandbox-ID`, scoped tokens | None; the sandbox opens outbound connections (Remote Control relay, work-queue polling) and listens on nothing | Zero inbound surface was a deliberate v1 choice (ADR-0009). A router only becomes necessary when something *calls into* sandboxes |
| Kernel boundary | Firecracker/libkrun/Kata microVM per session, snapshot boot, suspend/resume | Shared host kernel; pod user namespace + bubblewrap mount/net/pid namespaces + seccomp | Single bare-metal node, no nested virtualisation, no second node: a microVM runtime is a hardware change. The chart already carries `isolation.runtimeClassName` for when it exists. The user namespace makes "root in the pod" an unprivileged host uid, which is the compensating control (ADR-0003) |
| In-sandbox policy engine | OpenShell supervisor: Landlock, seccomp notify, per-binary deny-all egress, hot-reloadable rules, prover/advisor | Anthropic sandbox-runtime: bubblewrap binds, seccomp filter, proxy allowlist, `--control-fd` live updates, resolved-address guard | srt is what Claude Code itself uses, is one `npm install`, and already understands Claude Code's configuration paths (mandatory denies). OpenShell is 0.1.x, needs its gateway and the agent-sandbox CRDs, and is not on Anthropic's provider list yet (ADR-0005) |
| Credential handling | "The agent never sees real credentials" (OpenShell), "API key never reaches compute" (Lambda) | The wrapped process can read its own login file and the GitHub token; the environment key is scoped to one queue; no org API key anywhere | A one-owner lab accepts that residual; the matrix (ADR-0013) names credential brokering as an enterprise prerequisite. srt's `credentials` masking is the in-family path |
| Egress policy | OpenShell L7 with TLS inspection; Lambda VPC connector; GKE FQDN policy | Two layers from one list: srt domain allowlist + Cilium `toFQDNs` policy | Equivalent at the name level; TLS inspection is the missing step (domain fronting residual) |
| Per-session ephemerality | VM per session, destroyed or snapshotted at end | Workspaces are long-lived by design; worker sessions share one `/workspace` | Workspaces *should* persist (they are a developer's machine). The worker gap is phase 6 |
| Policy delivery | Gateway-owned global policy, admission policy in GKE | ConfigMap from values, GitOps | GitOps *is* the policy delivery for a homelab; an enterprise adds admission enforcement |
| Snapshots / warm start | GKE Pod Snapshots, Lambda snapshot boot, Substrate actor restore | Container start plus a 30 s login wait | Not needed for two sandboxes; becomes the main reason to adopt the control plane at scale |

## 4. What stays the same when we move toward the north star

- The **image** (srt + Claude Code + `ant`, non-root, read-only) is what a `SandboxTemplate`
  would reference; nothing in it assumes a Deployment.
- The **srt settings** are the policy document; they are what an OpenShell policy or a
  template-level policy would replace, field by field (allowWrite ↔ Landlock paths,
  allowedDomains ↔ network_policies, deniedResolvedAddresses ↔ metadata/IP denies).
- The **network policy** per sandbox is what agent-sandbox calls its "Managed NetworkPolicy"
  mode.
- The **GitOps delivery** and the **ADRs** carry over unchanged.

## 5. The path (ADR-0015)

1. Keep today's chart for the owner's workspaces.
2. For Managed Agents per-session sandboxes, install `kubernetes-sigs/agent-sandbox` on the
   k3s node and have the poller create a `SandboxClaim` per work item from a `SandboxTemplate`
   that uses this image; evaluate the warm pool. This is the control plane half of the north
   star, on-premises, with the same substrate we have.
3. When a KVM-capable node exists, add a Kata (or libkrun-backed) `RuntimeClass` to the
   template and switch srt to weak mode inside it; that is the microVM half.
4. Evaluate OpenShell's supervisor as the in-sandbox policy layer once it reaches a release
   Anthropic lists as a provider, comparing it against srt on the controls matrix rows it
   would change (credential brokering, L7 egress, policy prover).

## Sources

kubernetes-sigs/agent-sandbox README, overview, Runtime API, Sandbox Router README, Anthropic
Managed Agents use case; Google Cloud: Agent Sandbox install, Pod Snapshots, launch blog, About
Agent Substrate, agent-substrate/substrate README; AWS: Lambda MicroVMs guide, launching,
networking, Claude Managed Agents integration, pricing, What's New (June and October 2026);
NVIDIA OpenShell README, architecture, extensibility, runtimes, Kubernetes setup, support
matrix, policies overview, MAINTAINERS; Red Hat blogs on OpenShell and Claude self-hosted
sandboxes; Anthropic self-hosted sandboxes and security model; anthropics/sandbox-runtime.
