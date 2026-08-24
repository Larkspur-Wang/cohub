---
name: cohub-apps
description: Publish files, directory sites, or sandbox ports as public Cohub Apps and return shareable App URLs.
---

# Cohub Apps

Use this skill when a user wants a public link for a file, site, demo, or live preview from a Cohub Space.

Cohub Apps publish as public pages:

```text
/:ownerUsername/:spaceSlug/w/:appSlug
```

If `cohub apps` is unavailable, update the CLI: `npm install -g @neta-art/cohub-cli`.

## Use For

- HTML pages, boards, or other files
- directory sites
- generated demos
- live previews on port `3000` or `5173`
- App pages using Cohub runtime permissions

## Inputs

A published App needs:

- target Space ID
- App slug
- one target: file, directory, or port

Use the current Space by default:

```bash
space_id="${COHUB_SPACE_ID:-}"
```

When the target Space is unclear, ask for the Space.

## Targets

Choose one target:

- `--file <path>` for an HTML page, board, or any other file
- `--dir <path>` for a directory site with `index.html`
- `--port 3000` or `--port 5173` for a running preview

## App Slug

Use a short, stable App slug:

- `demo`
- `report`
- `dashboard`
- `landing-page`

Keep an existing slug when updating an App. Ask before changing a user-provided slug.

## Visibility

Default to `public`. Use `--visibility space` when the App should be visible only to people with Space access.

## Permissions

Start with empty scopes. Add the smallest permission set needed for the App.

App runtime scopes (`--app-scope`):

- `space.view`
- `session.view`
- `file.view`
- `taskrun.view`

Viewer-requestable scopes (`--viewer-scope`):

- `taskrun.view`
- `session.prompt.readonly`
- `session.prompt.fullaccess`
- `generation.create`
- `user.space.list`
- `user.session.list`
- `user.usage.read`

## Publish

Publish creates the App or updates an existing App with the same slug:

```bash
cohub -s "$space_id" apps publish "$app_slug" --file "$file" --json
cohub -s "$space_id" apps publish "$app_slug" --dir "$dir" --json
cohub -s "$space_id" apps publish "$app_slug" --port "$port" --json
```

Use `--visibility public` or `--visibility space` when needed. Use `--hide-cohub-bar` for immersive pages when requested (`--show-cohub-bar` restores it). Pass extra metadata with `--meta <json>`. Use `--disabled` or `--status disabled` to create without publishing.

For an existing App that only needs a fresh version from its current target:

```bash
cohub apps publish-version "$app_id" --json
```

## Public URL

Read the App by id, public URL, `cohub://apps` URI, or `username/space/app` reference:

```bash
cohub apps get "$app_ref" --json
```

Return `publicUrl`, falling back to `content.url` when needed.

## Manage

```bash
cohub apps ls
cohub apps update "$app_id" --visibility space --clear-viewer-scopes --json
cohub apps versions "$app_id"
cohub apps stats "$app_ref"
cohub apps download "$app_ref" -o ./out
cohub apps rm "$app_id" --yes
```

`update` can change the slug, visibility, target, scopes, and Cohub bar settings; use `--clear-app-scopes` / `--clear-viewer-scopes` to reset scopes.

## Identity Setup

If publishing reports missing public identity, check the Space and current user:

```bash
cohub spaces get "$space_id" --json
cohub auth whoami --json
```

If the current user is the Space owner, use user-provided or user-confirmed values to set the public identity:

```bash
cohub profile update --username "$owner_username" --json
cohub spaces update "$space_id" --slug "$space_slug" --json
```

## Safety

- Review target content before publishing.
- Confirm identity, permission, or status changes.
- Confirm before deleting an App.

## Finish

Return the public URL.
