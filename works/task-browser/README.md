# Task Browser Work

Repository-managed Work for browsing multimodal generation tasks. It derives its initial scope from `cohub.context().invocation` in this order: Session, Space, Mine. It never falls back to the Work's publishing Space.

## Build

```bash
pnpm --filter @cohub/work-task-browser build
```

## Publish

Run from a Cohub Space containing this repository:

```bash
cohub works publish task-browser \
  --dir works/task-browser/dist \
  --work-scope taskrun.view \
  --viewer-scope taskrun.view
```

Set the returned Work id as `PUBLIC_TASK_BROWSER_WORK_ID` for the Web deployment. Updating an existing Work uses the normal `cohub works publish-version <workId>` flow.
