# 0001. Record architecture decisions

Date: 2026-10-26
Status: Accepted

## Context

This sandbox will be operated for years by one person, extended by Claude agents that were not
present when it was designed, and may be ported to a larger environment later. The reasoning
behind a choice is what erodes first, and a security boundary whose reasoning is lost gets
widened by the next convenient change.

## Decision

Every significant decision is a numbered ADR under `docs/adr/` in this repository
(`ps-claude-sandbox-agent-runtime`), using the template in `README.md`. Accepted ADRs are not
edited; a later ADR supersedes them. The Helm chart lives in the same repository and its README
links here, so the decisions travel with the deployable artifact.

## Consequences

- A change to the pod security context, the egress lists, or the credential handling has to
  name the ADR it amends, which makes a weakening visible in review.
- Agents extending the system load a compact, authoritative history instead of re-deriving it.
- The control matrix (ADR-0013) can cite the ADR that implements each control.

## Alternatives considered

- One design document edited in place: loses the history of why boundaries moved.
- Commit messages only: not discoverable, not structured, not readable from the chart.
