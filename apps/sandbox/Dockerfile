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

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git wget jq ca-certificates openssh-client \
    iputils-ping iproute2 dnsutils \
    ripgrep fd-find file unzip zip \
    python3 python3-pip python3-venv python3-dev \
    ffmpeg imagemagick libimage-exiftool-perl \
    vim tree tmux htop xz-utils less \
    build-essential \
    strace lsof \
    fonts-noto-cjk \
    bash procps \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

RUN ln -sf /usr/bin/python3 /usr/bin/python && \
    ln -sf /usr/bin/fdfind /usr/local/bin/fd

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
RUN npm install -g typescript tsx @typescript/native-preview

WORKDIR /app

COPY --from=builder /out/cohub-sandbox /usr/local/bin/cohub-sandbox

RUN mkdir -p "$WORKSPACE_DIR"

USER node

CMD ["cohub-sandbox"]
