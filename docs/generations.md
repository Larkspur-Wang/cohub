# Generations

Cohub generations provide a small multimodal generation API driven by declaration files.

## API

```http
GET  /api/generations/declarations
POST /api/generations
```

`POST /api/generations` accepts:

```ts
type CreateGenerationRequest = {
  model: string;
  content: GenerationContentBlock[];
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
```

`content` contains the prompt and any reference files:

```ts
type GenerationSource =
  | { type: "url"; url: string }
  | { type: "base64"; media_type: string; data: string }
  | { type: "space_file"; space_id: string; path: string };

type GenerationContentBlock =
  | { type: "text"; text: string; _meta?: Record<string, unknown> }
  | { type: "image"; source: GenerationSource; _meta?: Record<string, unknown> }
  | { type: "video"; source: GenerationSource; _meta?: Record<string, unknown> }
  | { type: "audio"; source: GenerationSource; _meta?: Record<string, unknown> };
```

The response is a `Generation` with `input` and generated `output` content blocks. The first implementation runs synchronously and returns `succeeded` or `failed` directly.

## Declarations

Generation declarations live in:

```txt
.cohub/generations/*.yaml
```

Platform declarations are loaded from `platform/.cohub/generations`, and user declarations from `users/<userId>/.cohub/generations`. User declarations override platform declarations with the same `model`.

Public declaration listing never returns the private `adapter` field.

Minimal shape:

```yaml
schema: cohub.generation.v1
model: gpt-image-2
title: GPT Image 2
description: Image generation with optional reference images.

adapter:
  type: openai.images
  base_url: https://new-api.talesofai.com/v1
  api_key: $env:GPT_IMAGE_API_KEY

content:
  input:
    - type: text
      required: true
      min: 1
      merge: newline
    - type: image
      max: 16
      sources: [url, base64, space_file]

parameters:
  size:
    type: string
    optional: true
    default: 1024x1024
  quality:
    type: string
    optional: true
    default: auto
    enum: [auto, low, medium, high]
```

See the full examples:

- [`docs/examples/generations/gpt-image-2.yaml`](./examples/generations/gpt-image-2.yaml)
- [`docs/examples/generations/gemini-3.1-flash-image-preview.yaml`](./examples/generations/gemini-3.1-flash-image-preview.yaml)
- [`docs/examples/generations/seedance-2-0-fast.yaml`](./examples/generations/seedance-2-0-fast.yaml)
- [`docs/examples/generations/seedance-2-0.yaml`](./examples/generations/seedance-2-0.yaml)

## CLI

```bash
cohub generations ls

cohub generate "a cyberpunk cat in neon rain" \
  --model gpt-image-2 \
  --param size=1024x1024 \
  --param quality=high

cohub generate "same character, smiling" \
  --model gpt-image-2 \
  --image ./character.png \
  --param quality=high \
  --json

cohub generate "a vibrant infographic explaining photosynthesis" \
  --model gemini-3.1-flash-image-preview \
  --param aspect_ratio=16:9 \
  --param image_size=1K

cohub generate "a cat playing piano in a cozy jazz club" \
  --model seedance-2-0-fast \
  --param duration=5 \
  --param resolution=720p
```

Use `$env:NAME` for API keys in YAML. Do not commit real API keys.
