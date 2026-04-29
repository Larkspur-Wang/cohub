# @neta-art/cohub-cli

CLI for [Cohub](https://cohub.run) — spaces, sessions, and agent collaboration.

## Installation

```bash
npm install -g @neta-art/cohub-cli
```

## Usage

```bash
cohub --help
```

## Environment

The CLI connects to production by default:

- API: `https://api.cohub.run`
- WebSocket: `wss://gateway.cohub.run/ws`

Use the development environment with `ENV=dev`:

```bash
ENV=dev cohub spaces ls
```

Development uses:

- API: `https://api-dev.cohub.run`
- WebSocket: `wss://gateway-dev.cohub.run/ws`

Auth tokens are stored per environment:

- prod: `~/.config/cohub/token`
- dev: `~/.config/cohub/token.dev`
