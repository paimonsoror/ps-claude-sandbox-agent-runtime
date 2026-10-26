# 0015. North star: a control plane over pluggable sandbox substrates

Date: 2026-10-26
Status: Proposed

## Context

A principal engineer framed the target as "an on-premise version of Google's control plane
around substrate, but with Lambda microVM with OpenShell as a backend provider". Decoded from
the primary sources ([north-star](../north-star.md)): a Kubernetes-native sandbox lifecycle
control plane (the `kubernetes-sigs/agent-sandbox` CRDs: Sandbox, SandboxTemplate,
SandboxWarmPool, SandboxClaim, plus router and admission policy), running on our own cluster,
with the isolation layer swappable between a Firecracker-class microVM per session and
NVIDIA/Red Hat OpenShell's supervisor-enforced policy sandbox.

What we built (ADR-0003 to 0012) is the substrate layer only: an image and a policy document
(srt settings) inside hardened pods, delivered by GitOps. It has no lifecycle API, no warm
capacity, no per-session claims, no router, and a shared kernel.

Facts that constrain the path:

- agent-sandbox is runtime-agnostic only through `RuntimeClass`; it has no provider API.
- Lambda MicroVMs is cloud-only; the on-premises equivalents are Firecracker, libkrun
  (OpenShell's VM driver) and Kata via `RuntimeClass`, all of which need KVM on the node.
- OpenShell on Kubernetes *consumes* agent-sandbox (its driver creates `Sandbox` objects and a
  supervisor pod). It is 0.1.x and not on Anthropic's Managed Agents provider list.
- The homelab node is single, bare-metal, without nested virtualisation; a microVM runtime is a
  hardware change, not a chart change.

## Decision

Adopt the north star as the direction and stage it so each step is useful on its own:

1. **Now**: the chart stays the owner's workspace layer. Its image, srt policy, network policy
   and ADRs are designed to be referenced from a `SandboxTemplate` later without change.
2. **Control plane first (plan phase 6)**: install `kubernetes-sigs/agent-sandbox` on the
   cluster; replace the always-on Managed Agents worker with a poller that creates one
   `SandboxClaim` per work item against a `SandboxTemplate` built from this image; evaluate
   `SandboxWarmPool`. Record the result as a new ADR that supersedes ADR-0010.
3. **Substrate second**: when a KVM-capable node exists, add a Kata or libkrun-backed
   `RuntimeClass` to the template and run srt in weak mode inside the microVM; this also
   closes the PSS *restricted* gap (ADR-0013).
4. **Policy layer evaluation**: compare OpenShell's supervisor with srt on the controls-matrix
   rows it changes (credential brokering, per-binary L7 egress, policy prover). Switch only if
   it wins on those rows and Anthropic lists it as a provider; otherwise pursue srt's own
   `credentials` masking and `tlsTerminate`.

## Consequences

- The owner can explain the difference to the principal engineer in one line: *same
  substrate shape (hardened image + policy document), control plane and kernel boundary still to
  come, each blocked by one concrete thing (a controller install; a KVM node).*
- No rewrite is implied: the artifacts from ADR-0003 to 0012 are the inputs to step 2.
- Step 2 introduces a component with its own CRDs and RBAC into the cluster; it gets its own
  ADR and its own entry in the app-of-apps.

## Alternatives considered

- **Adopt OpenShell now as the runtime**: adds a gateway, CRDs and a 0.1.x policy engine to a
  two-sandbox setup, and inverts the dependency the PE described (OpenShell would be the
  control plane, agent-sandbox the substrate).
- **Build a custom controller**: agent-sandbox already exists, is a SIG project, and is what
  both Google and OpenShell build on.
- **Stay with Deployments forever**: fine for workspaces, wrong for per-session Managed Agents
  sandboxes (ADR-0010 consequences).
