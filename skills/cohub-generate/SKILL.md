---
name: cohub-generate
description: Generate or transform images, video, and music with Cohub multimodal models via `cohub generate`. Use when the user asks to create, edit, restyle, animate, or remove backgrounds from media, or generate songs.
---

# Cohub Multimodal Generation

Use `cohub generate` to create or transform images, video, and music.

Prefer simple, explicit commands. Use `--json` when reading output for decisions, extracting URLs, or chaining commands. If a target Space is required, add `-s "$COHUB_SPACE_ID"` or an explicit Space ID.

## Installation

If `cohub` is unavailable, install it and check availability:

```bash
npm install -g @neta-art/cohub-cli
cohub --help
```

## Models

Always resolve models from the live list; do not hardcode a catalog.

```bash
cohub models ls --model-type multimodal --json
```

Typical categories: text-to-image / image editing, text-to-video / image-to-video, background removal, music.

Before using non-default parameters or reference media, inspect the model schema for supported inputs, roles, parameters, defaults, and examples:

```bash
cohub models show <model> --json
```

## Generate

Default to returning generated result links directly, with Markdown preview when possible (`![alt](url)` for images, direct links for video and audio). Save locally only when the user asks for a file download, local editing, or post-processing.

Generate from text:

```bash
cohub generate "a calm lake at sunrise" \
  --model <model>
```

Generate with reference media:

```bash
cohub generate "restyle this image" \
  --model <model> \
  --image ./input.png \
  --param size=1024x1024
```

Supported inputs: `--image`, `--video`, and `--audio`, each accepting a local path or URL and repeatable.

When a model requires input roles, prefix the path or URL:

```bash
cohub generate "smooth transition between two shots" \
  --model <model> \
  --image first_frame=https://example.com/first.png \
  --image last_frame=https://example.com/last.png

cohub generate "keep these characters consistent" \
  --model <model> \
  --image reference_image=https://example.com/a.png \
  --image reference_image=https://example.com/b.png
```

Roles include `first_frame`, `last_frame`, `reference_image`, and `reference_video`. Check `models show` for what a model accepts.

Pass generation parameters with `--param key=value` (repeatable; JSON, number, or boolean values) or `--parameters '<json>'`:

```bash
cohub generate "cinematic drone shot over misty mountains" \
  --model <model> \
  --param duration=5 \
  --param resolution=720p \
  --param aspect_ratio=16:9
```

Other useful flags:

```bash
cohub generate "..." --model <model> --output ./out.png   # save locally
cohub generate "..." --model <model> --async              # queue and return
cohub generate "..." --model <model> --timeout-ms 120000  # sync wait limit
cohub generate "..." --model <model> --meta '<json>'      # attach metadata
```

## Workflows

Animate a still image:

```bash
cohub generate "<motion prompt>" \
  --model <model> \
  --image first_frame=./still.png
```

Edit or restyle with a reference image:

```bash
cohub generate "<edit instruction>" \
  --model <model> \
  --image ./input.png
```

For less common options, use `cohub generate -h`.

