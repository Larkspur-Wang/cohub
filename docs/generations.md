# Generations

Cohub generations provide a small task-based multimodal generation API. Model declarations are loaded from `.cohub/generations` and use the `@neta-art/generation` declaration schema.

## API

```http
GET  /api/models?modelType=multimodal
POST /api/generations
```

`POST /api/generations` accepts:

```ts
type CreateGenerationTaskRequest = {
  spaceId: string;
  model: string;
  content: GenerationContentBlock[];
  parameters?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};
```

`content` contains the prompt and any reference media:

```ts
type GenerationSource =
  | { type: "url"; url: string }
  | { type: "base64"; mediaType: string; data: string };

type GenerationContentBlock =
  | { type: "text"; text: string; meta?: Record<string, unknown> }
  | { type: "image"; source: GenerationSource; meta?: Record<string, unknown> }
  | { type: "video"; source: GenerationSource; meta?: Record<string, unknown> }
  | { type: "audio"; source: GenerationSource; meta?: Record<string, unknown> };
```

The API queues a generation task and returns a task ID. Use task polling, or the SDK / CLI helpers, to wait for the final `GenerationTaskResult`:

```ts
type GenerationTaskResult = {
  model: string;
  output: GenerationContentBlock[];
  /** Provider response `request_id` from `@neta-art/generation` */
  requestId?: string;
  /** Official request price from provider `usage.cost` */
  cost?: number;
  meta?: Record<string, unknown>;
};
```

`requestId` and `cost` are observed provider fields captured via `generateResult()`. Older completed tasks may omit them.

## Billing

Generation requests share the platform credit balance with LLM turns.

1. **Preflight gate** — `POST /api/generations` and the worker re-check the caller's balance before enqueue/execute. Hard debt returns the standard 402 `billing` conversion payload; soft debt may attach a warning on the 202 response.
2. **Post-success charge** — after a successful provider call, the worker records usage from the official provider `cost` (USD):

```ts
operationId: `generation:${taskRunId}`  // idempotent
usageType: "generation.image" | "generation.video" | "generation.music" | "generation"
amountUsd: result.cost
```

Usage type is resolved from the model adapter (preferred) or output content types. Missing/non-positive `cost` skips charging and stores `billing.status = "skipped"` with reason `missing_cost` (task still succeeds — cost gaps are platform issues and must not break the user path; they are logged for ops follow-up). Transient billing write failures still complete the generation task, then enqueue an idempotent `generation.billing_retry` job (`operationId = generation:${taskRunId}`, up to 8 attempts with exponential backoff).

Completed tasks may include:

```ts
billing?: {
  amountUsd: number;
  usageType: string;
  status: "recorded" | "overage" | "skipped";
  reason?: string | null;
} | null
```

## Usage stats

Successful provider calls upsert into `v2.generation_usage_stats_hourly` (space / user / session / usageType / adapter / model / hour). Idempotency peeks Redis before write and commits the key only after a successful DB upsert, so a failed write can retry. Dimension columns are NOT NULL with sentinels. The `provider` column stores the **adapter type** (e.g. `openai.images`). Stats are success-only (`errorCount` stays 0 by design).

Gate resolves modality from request content; billing/stats re-resolve after success using output content (preferred) then request content.

These rollups feed:

- Generation trending (`/api/trending/generations/{spaces,users,models}`) — ranked by request count, then cost
- Space / user usage endpoints as an optional `generation` block alongside token stats

LLM trending (`/api/trending/{spaces,users,models}`) remains token-only and is still ranked by tokens.

## Declarations

Generation declarations live in:

```txt
.cohub/generations/*.yaml
```

Platform declarations are loaded from `platform/.cohub/generations`, and user declarations from `users/<userId>/.cohub/generations`. User declarations override platform declarations with the same `model`.

Declarations use `neta.generation.model.v1`. Adapter credentials and provider base URLs are not stored in model declarations. Worker execution uses `NETA_ROUTER_API_KEY`, while provider routing defaults are handled by `@neta-art/generation`.

Minimal shape:

```yaml
schema: neta.generation.model.v1
model: gpt-image-2
title: GPT Image 2
description: Image generation with optional reference images.

adapter:
  type: openai.images

content:
  input:
    - type: text
      required: true
      min: 1
      merge: newline
    - type: image
      max: 16
      sources: [url, base64]

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
- [`docs/examples/generations/suno_music.yaml`](./examples/generations/suno_music.yaml)

## CLI

```bash
cohub models ls --model-type multimodal

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

cohub generate "smoothly transition from the first frame to the last frame" \
  --model seedance-2-0-fast \
  --image first_frame=https://example.com/first.png \
  --image last_frame=https://example.com/last.png \
  --param duration=5

cohub generate "keep the character identity from all reference images" \
  --model seedance-2-0-fast \
  --image reference_image=https://example.com/reference-1.png \
  --image reference_image=https://example.com/reference-2.png \
  --param duration=5

cohub generate "uplifting cinematic pop with warm piano and clear chorus" \
  --model suno_music \
  --param operation=music \
  --meta '{"title":"Warm Horizon","tags":"cinematic pop, warm piano","make_instrumental":false}'

cohub generate "write a hopeful chorus about sunrise after a storm" \
  --model suno_music \
  --param operation=lyrics
```

Role-qualified media values add `meta.role` to that content block. Repeat `--image reference_image=...` for multiple reference images. Seedance role-qualified media should use public URL inputs. Do not mix first/last frame roles with reference roles in one request.
