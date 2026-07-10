---
name: cohub-works-share
description: Publish files, directory sites, or sandbox ports as public Cohub Works and return shareable Work URLs.
---

# Cohub Works Share

Use this skill when a user wants a public link for a file, site, demo, or live preview from a Cohub Space.

Cohub Works publish as public pages:

```text
/:ownerUsername/:spaceSlug/w/:workSlug
```

## Use For

- HTML pages
- directory sites
- generated demos
- live previews on port `3000` or `5173`
- Work pages using Cohub runtime permissions

## Inputs

A published Work needs:

- target Space ID
- Work slug
- one target: HTML file, directory, or port

Use the current Space by default:

```bash
space_id="${COHUB_SPACE_ID:-}"
```

When the target Space is unclear, ask for the Space.

## Targets

Choose one target:

- `--file <path>` for an `.html` or `.htm` file
- `--dir <path>` for a directory containing `index.html`
- `--port 3000` or `--port 5173` for a running preview

## Work Slug

Use a short, stable Work slug:

- `demo`
- `report`
- `dashboard`
- `landing-page`

Keep an existing slug when updating a Work. Ask before changing a user-provided slug.

## Visibility

Default to `public`. Use `--visibility space` when the Work should be visible only to people with Space access.

## Permissions

Start with empty scopes. Add the smallest permission set needed for the Work.

Direct Work scopes:

- `space.view`
- `session.view`
- `file.view`
- `taskrun.view`

Viewer-grant scopes:

- `session.prompt.readonly`
- `session.prompt.fullaccess`
- `generation.create`
- `user.space.list`
- `user.session.list`
- `user.usage.read`

## Publish

Publish creates the Work or updates an existing Work with the same slug:

```bash
cohub -s "$space_id" works publish "$work_slug" --file "$file" --json
cohub -s "$space_id" works publish "$work_slug" --dir "$dir" --json
cohub -s "$space_id" works publish "$work_slug" --port "$port" --json
```

Use `--visibility public` or `--visibility space` when needed. Use `--hide-cohub-bar` for immersive pages when requested.

For an existing Work that only needs a fresh version from its current target:

```bash
cohub works publish-version "$work_id" --json
```

## Public URL

After publish or publish-version, read the Work by ID:

```bash
cohub works get "$work_id" --json
```

Return `publicUrl`, falling back to `content.url` when needed.

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

## Finish

Return the public URL.

