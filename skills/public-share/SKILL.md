---
name: public-share
description: Publish files from the runtime to the public share directory and return direct public URLs.
---

# Public Share

Use this skill when a user wants a file or static page to be publicly accessible by link.

Public files live under:

- `/public`

Public base URL is provided by:

- `PUBLIC_URL_PREFIX`

Examples:

- `/public/demo/index.html` -> `${PUBLIC_URL_PREFIX}/demo/index.html`
- `/public/reports/demo/report.html` -> `${PUBLIC_URL_PREFIX}/reports/demo/report.html`

## Use for

- static HTML pages
- markdown or text exports
- images
- JSON artifacts
- small multi-file demos

## Rules

- Only put files in `/public` if they are meant to be public.
- Never place secrets, tokens, private logs, or internal-only files in `/public`.
- Prefer publishing into a dedicated subfolder under `/public`, not directly into `/public` root.
- Group related files together, for example `demo/`, `reports/<name>/`, `exports/<name>/`.
- For shareable browser output, prefer a main HTML file inside its own folder.
- Shared links must point to a specific file (e.g. `index.html`), never just a folder path.
- Use relative asset paths inside HTML, such as `./app.js` or `./assets/chart.png`.

## Important working style

Treat `/public` as a publish target, not a working directory.

- Avoid heavy editing, scanning, or repeated list-style operations inside `/public`.
- Prefer building files somewhere else first.
- When the result is ready to publish, copy the final file or final folder into `/public`.
- If publishing a multi-file site, prepare the folder elsewhere, then copy the final folder into `/public` in one go.

This keeps the public area clean and reduces noisy file operations on the mounted share.

## Workflow

1. Build or edit files outside `/public` when possible.
2. Copy the final file or folder into a dedicated subfolder under `/public`.
3. Construct the public URL from `PUBLIC_URL_PREFIX` plus the relative path under `/public`.
4. Return the direct URL.

## Examples

Single page site:

- write `/public/demo/index.html`
- return `${PUBLIC_URL_PREFIX}/demo/index.html`

Nested demo:

- write `/public/demos/todo/index.html`
- return `${PUBLIC_URL_PREFIX}/demos/todo/index.html`

Raw artifact:

- write `/public/data/output/result.json`
- return `${PUBLIC_URL_PREFIX}/data/output/result.json`

## Before finishing

Check that:

- the final files are under `/public`
- they are organized in a dedicated folder, not scattered in `/public` root
- the returned URL matches the path under `/public`
- no sensitive content was published

