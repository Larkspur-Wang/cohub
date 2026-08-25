# Model tasks

Platform and user configuration can define auxiliary model tasks in `.cohub/model-tasks.json`.

```json
{
  "sessionTitle": {
    "enabled": true,
    "model": {
      "provider": "cohub",
      "id": "title-model"
    },
    "prompt": "Write a concise session title in the user's language that captures the main topic. Return only the title."
  },
  "imageToText": {
    "enabled": true,
    "model": {
      "provider": "cohub",
      "id": "vision-model"
    },
    "prompt": "Describe the image accurately and concisely."
  }
}
```

A task model resolves `provider` and `id` from the merged platform and user `models.json` catalog. Any additional model fields use the same schema as `models.json` and override the catalog entry. A complete standalone model can be configured when no catalog entry exists.

User task configuration merges over platform configuration. Set a task's `enabled` field to `false` to disable it. The `imageToText` model must support image input.
