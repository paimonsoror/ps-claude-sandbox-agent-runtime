# 0006. Egress control in two layers from one domain list

Date: 2026-10-26
Status: Accepted

## Context

srt removes the sandboxed command's network namespace and routes HTTP(S) and SOCKS through its
proxies, which enforce `network.allowedDomains`. That stops anything inside bubblewrap from
reaching the network directly. It does not constrain srt itself, the entrypoint, or anything
that escapes bubblewrap: those see the pod's network, and on this cluster a pod can reach every
VLAN the LAB zone is allowed to reach plus every in-cluster Service (Vault, Postgres, ArgoCD,
Authentik...).

Upstream also warns that an allowlisted name can be used for domain fronting, and that
`github.com` is broad enough to exfiltrate through.

Cilium on this cluster enforces network policy and has a DNS proxy, so FQDN-based egress policy
(`toFQDNs`) is available without touching the node.

## Decision

One list per sandbox, `allowedDomains` (chart `network.baseAllowedDomains` plus the entry's own
`allowedDomains`), renders two controls:

1. **srt proxy allowlist**: `network.allowedDomains` in `/etc/srt/settings.json`, with
   `strictAllowlist: true` so an unlisted host is denied rather than asked (there is nobody to
   ask in a pod). Entries keep srt's grammar (`*.github.com`, `host:443`).
2. **CiliumNetworkPolicy** per sandbox pod:
   - egress to the cluster DNS endpoints on 53 with `rules.dns.matchPattern: "*"` (which turns
     on the DNS proxy that `toFQDNs` needs);
   - egress on 443 to `toFQDNs` entries derived from the same list (port suffixes stripped,
     wildcards kept as `matchPattern`);
   - nothing else. No ingress. No cluster-internal destinations unless an entry opts in through
     `network.extraEgress` (a raw list of Cilium egress rules, for a future Vault or registry
     need).

Base list for every sandbox: `api.anthropic.com`. Workspaces add `claude.ai`, `claude.com`,
`platform.claude.com`, `sso.claude.com` (login and Remote Control), `github.com`,
`*.github.com`, `objects.githubusercontent.com`, `raw.githubusercontent.com`,
`registry.npmjs.org`, `*.npmjs.org`, `pypi.org`, `files.pythonhosted.org`, `code.claude.com`.
Workers add only what their tasks need. The Datadog telemetry hosts are not listed;
`DISABLE_TELEMETRY=1` is set instead.

## Consequences

- A process outside bubblewrap but inside the pod (the entrypoint's `git clone`, srt's own
  proxies, an escaped command) still only reaches the listed names on 443 and the cluster DNS.
  Lateral movement to the LAN or other namespaces is blocked at the CNI.
- The proxy stays the place where per-command, per-session and reason-bearing denials happen;
  the network policy is the backstop with coarser (name + port) granularity.
- Two renderings of one list means a name allowed in srt but typo'd in the policy fails loudly
  (TLS connect blocked) rather than silently widening. The chart template is the single source.
- DNS answers are what the policy trusts. The cluster DNS is TelltaleDNS with DNSSEC off; a
  poisoned answer could point an allowed name at another address. srt's resolved-address guard
  already refuses loopback, link-local and the node's own addresses; `deniedResolvedAddresses`
  for the RFC 1918 ranges is set in the srt settings so a name cannot be aimed at the LAN.
- UDP, QUIC and ICMP never leave the pod.

## Alternatives considered

- **iptables init script in the pod** (the Claude Code devcontainer pattern): needs `NET_ADMIN`
  and `NET_RAW`; a policy object outside the pod is strictly better here.
- **Kubernetes NetworkPolicy** (CIDR-based): cannot express names; a 443-to-anywhere rule would
  leave the proxy as the only name control. Kept as the portable fallback in the chart
  (`network.policy.engine: kubernetes`) for clusters without Cilium.
- **TLS-terminating proxy with content inspection**: srt's `tlsTerminate` exists but is
  experimental and adds a CA to manage; listed for the enterprise port (ADR-0013), not v1.
