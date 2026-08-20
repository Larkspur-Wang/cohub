# Task Browser

A reference [Cohub Work](https://cohub.live) for browsing multimodal generation tasks. It is a standalone Svelte application built entirely with public npm packages, so the directory can be copied out of this repository and developed independently.

## What It Demonstrates

- Loading Work identity and invocation context with `cohub.context()`
- Requesting viewer consent with `cohub.auth.request()`
- Listing generation Tasks with the public Cohub SDK
- Resolving scope from invocation context in `Session > Space > Mine` order
- Rendering every image, video, audio, and text output as an independent item
- Cursor pagination, active Task refresh, deferred media loading, and responsive layout

The invocation Space can differ from the Space that publishes this Work. The app never falls back to the publishing Space when invocation context is absent.

## Requirements

- Node.js 22 or newer
- A Cohub account
- The Cohub CLI: `npm install --global @neta-art/cohub-cli`

## Develop

```bash
cd works/task-browser
npm install
npm run dev
```

The Cohub runtime APIs only work inside a published Work. Local development is useful for layout and unit tests; use a published preview to test context, authorization, and API calls.

Run the complete local verification suite:

```bash
npm run check
```

## Publish

Build the project:

```bash
npm run build
```

Work targets are relative to the Cohub Space root. If this project is the Space root, publish with:

```bash
cohub works publish task-browser \
  --dir dist \
  --work-scope taskrun.view \
  --viewer-scope taskrun.view \
  --hide-cohub-bar
```

If the project is nested in a larger Space, pass its Space-relative output path. From the root of this repository, for example:

```bash
cohub works publish task-browser \
  --dir works/task-browser/dist \
  --work-scope taskrun.view \
  --viewer-scope taskrun.view \
  --hide-cohub-bar
```

`taskrun.view` has two roles here:

- The Work scope reads Tasks in the publishing Space.
- The viewer scope lets a viewer authorize access to Tasks they can already view in another invocation Space or Session.

Viewer authorization never grants more access than the viewer already has.

Running the same publish command updates the existing Work with a new immutable version.

## Preview

Open a published Work by ID, public URL, or `username/space/work` reference:

```bash
cohub ui preview <work-id>
cohub ui preview https://cohub.live/tzwm/cohub/w/task-browser
cohub ui preview tzwm/cohub/task-browser
```

When an Agent opens the Work with `cohub ui preview`, the SDK exposes the originating identifiers through:

```ts
const context = await cohub.context();
const { spaceId, sessionId } = context?.invocation ?? {};
```

These identifiers choose the initial browser scope. They do not bypass Cohub authorization.

## Project Structure

```text
src/App.svelte          UI, loading, pagination, and refresh behavior
src/scope.ts            Session > Space > Mine scope resolution
src/task-output.ts      Task Run to multimodal gallery projection
src/media.ts            Deferred media detail resolution
work.json               Publish metadata and permission declaration
```

## License

Apache-2.0
