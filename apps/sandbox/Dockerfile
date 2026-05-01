# syntax=docker/dockerfile:1.7

FROM golang:1.24-bookworm AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/cohub-sandbox .

FROM node:24-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV WORKSPACE_DIR=/workspace
ENV PLATFORM_AGENTS_DIR=/configs/platform/.agents

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    curl git wget ca-certificates openssh-client \
    iputils-ping iproute2 dnsutils \
    file unzip zip \
    python3 python3-pip python3-venv python3-dev \
    ffmpeg imagemagick libimage-exiftool-perl \
    vim tree tmux htop xz-utils less \
    build-essential \
    strace lsof \
    fonts-noto-cjk \
    bash procps \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install latest core CLI tools from GitHub releases (apt versions are too old)
RUN curl -fsSL https://github.com/sharkdp/fd/releases/download/v10.4.2/fd-v10.4.2-x86_64-unknown-linux-gnu.tar.gz | tar xz --wildcards -C /usr/local/bin --strip-components=1 '*/fd' \
 && curl -fsSL https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz | tar xz --wildcards -C /usr/local/bin --strip-components=1 '*/rg' \
 && curl -fsSL https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-linux-amd64 -o /usr/local/bin/jq \
 && chmod +x /usr/local/bin/fd /usr/local/bin/rg /usr/local/bin/jq

RUN ln -sf /usr/bin/python3 /usr/bin/python

# Package managers: redirect global installs to node user's home directory
# so they work after `USER node` switch
ENV BUN_INSTALL=/home/node/.bun
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PIP_USER=true
ENV PATH="/home/node/.bun/bin:${NPM_CONFIG_PREFIX}/bin:/home/node/.local/bin:/home/node/go/bin:/home/node/.pnpm-global/bin:${PATH}"

RUN curl -fsSL https://bun.sh/install | bash
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
RUN npm install -g typescript tsx @typescript/native-preview
# Create directories and ensure node user owns them for runtime access
RUN mkdir -p /home/node/.npm-global /home/node/.bun /home/node/.local /home/node/go/bin /home/node/.pnpm-global/bin \
    && chown -R node:node /home/node/.npm-global /home/node/.bun /home/node/.local /home/node/go /home/node/.pnpm-global

# Install Go toolchain
RUN curl -fsSL https://go.dev/dl/go1.24.2.linux-amd64.tar.gz | tar xz -C /usr/local
ENV PATH="/usr/local/go/bin:${PATH}"

WORKDIR /app

COPY --from=builder /out/cohub-sandbox /opt/cohub/internal/cohub-sandbox

RUN mkdir -p "$WORKSPACE_DIR"
# Ensure workspace is writable by the node user
RUN chown -R node:node "$WORKSPACE_DIR" 2>/dev/null || true

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/cohub/internal/cohub-sandbox"]
