# Claude sandbox image: Anthropic sandbox-runtime (srt) wrapping either Claude Code in
# Remote Control server mode or the Managed Agents environment worker (ant).
# Design: https://github.com/paimonsoror/ps-claude-sandbox-agent-runtime (docs/adr). Pins are build args so a
# bump is a one-line change and a new sha-<short> tag.
FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.311
ARG SRT_VERSION=0.0.81
ARG ANT_VERSION=2.3.0
ARG TARGETARCH=amd64

ENV DEBIAN_FRONTEND=noninteractive

# bubblewrap, socat and ripgrep are srt's Linux dependencies; procps gives the liveness probe
# pgrep; tini reaps the children srt leaves when a sandboxed command is killed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bubblewrap socat ripgrep \
      git curl ca-certificates jq tini procps less bash \
      python3 python3-venv python3-pip openssh-client unzip tar xz-utils \
 && rm -rf /var/lib/apt/lists/*

# Installed under /usr/local, outside every path the sandbox may write (README, "Where This
# Package Is Installed"). The image's root filesystem is read-only at runtime (ADR-0008).
RUN npm install -g "@anthropic-ai/sandbox-runtime@${SRT_VERSION}" "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

# ant: the Managed Agents CLI and self-hosted environment worker.
RUN curl -fsSL "https://github.com/anthropics/anthropic-cli/releases/download/v${ANT_VERSION}/ant_${ANT_VERSION}_linux_${TARGETARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin ant \
 && chmod 0755 /usr/local/bin/ant

# The runtime user is uid 1000 (`agent`), reusing the base image's `node` uid so file ownership
# on the volumes is stable. /workspace and /mnt/memory are volume mount points.
RUN groupmod -n agent node \
 && usermod -l agent -d /home/agent -m node \
 && mkdir -p /workspace /mnt/memory /etc/srt /etc/claude-code \
 && chown agent:agent /workspace /mnt/memory

COPY entrypoint.sh /usr/local/bin/sandbox-entrypoint
RUN chmod 0755 /usr/local/bin/sandbox-entrypoint

USER agent
WORKDIR /workspace
ENV HOME=/home/agent \
    CLAUDE_CODE_TMPDIR=/tmp/claude \
    DISABLE_UPDATES=1 \
    DISABLE_TELEMETRY=1 \
    SRT_SETTINGS=/etc/srt/settings.json

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/sandbox-entrypoint"]
