# 0002. Target platform and repository layout

Date: 2026-10-26
Status: Accepted (target platform); repository layout superseded by [0014](0014-standalone-repository-and-oci-chart.md)

## Context

Two hosts were candidates: the production homelab cluster and the disposable lab VM. Probed on
2026-10-26, the homelab cluster is a single bare-metal node (`homelab`, 192.168.5.2): Ryzen 5
5500U, 12 threads, 28 GiB RAM, 130 GB free NVMe, Ubuntu 22.04.5 with HWE kernel 6.8.0-138,
k3s v1.36.4+k3s1 on containerd v2.3.4, Cilium 1.20.1 (ingress class `cilium`, LB pool
192.168.5.100-200), ArgoCD v2.14.9 driven by the `homelab-charts` app-of-apps, cert-manager,
Authentik, Vault CE with External Secrets Operator, Prometheus, Loki, and `local-path` as the
only StorageClass. AppArmor is enabled; `kernel.unprivileged_userns_clone=1` and
`kernel.apparmor_restrict_unprivileged_userns=0`. The lab VM (192.168.3.221) runs KIND on Linux
Mint and is not part of the GitOps environment.

The owner asked that the Helm chart be part of the existing app-of-apps and chose to keep it
inside `homelab-charts` rather than publishing an OCI chart from a separate repository.

## Decision

- **Target**: the k3s cluster on 192.168.5.2. Nothing is installed on the node; every piece
  is a Kubernetes object delivered by ArgoCD. The platform already meets the kernel (>= 6.3),
  containerd (>= 2.0) and Kubernetes (1.36, user namespaces and `ProcMountType` GA)
  requirements the isolation model (ADR-0003) depends on.
- **Chart and image live in `homelab-charts`**: `charts/claude-sandbox/` (Helm chart),
  `images/claude-sandbox/` (Dockerfile and entrypoint) and
  `.github/workflows/claude-sandbox-image.yml` (builds and pushes
  `ghcr.io/paimonsoror/claude-sandbox:sha-<short>`). The Application entry goes in
  `charts/argocd-apps/values.yaml` like every other app.
- **Design home is this repository** (then the local `claude-srt` directory): the upstream `sandbox-runtime` clone for
  reference, the ADRs, the plan, the spike evidence, the control matrix and the explainer page.
  The chart README links here.
- **Namespace**: `claude-sandbox`, created by the Application (`CreateNamespace=true`).

## Consequences

- One repository drives deployment, so the existing `tools/bump.py` flow (Backstage form, PR,
  in-cluster sync watcher) can roll the image tag like any other `image.tag` in the values block.
- Portability is by copy: the chart has no dependency on anything else in `homelab-charts`, so
  moving it to its own repository and OCI registry later is a `helm package` away (the plan lists
  this as an optional step).
- The single-node cluster means every sandbox shares one kernel with every other workload. The
  isolation model accepts that and compensates with user namespaces; a kernel-level boundary
  (microVM) would need a second node or nested virtualisation, neither of which exists today.

## Alternatives considered

- **Lab VM with KIND**: disposable, but KIND nodes are themselves containers, which complicates
  pod user namespaces and would not exercise the real GitOps path.
- **Separate repository publishing an OCI chart** (the TelltaleDNS pattern): more portable,
  but the owner first preferred the simpler single-repository layout. Reversed the same day
  once the chart existed: see ADR-0014.
