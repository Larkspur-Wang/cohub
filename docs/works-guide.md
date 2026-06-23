# Cohub Works Guide

Works are published, shareable surfaces that turn a Space file, directory, or public sandbox port into a public Cohub page.

Use Works when a Space produces something people should open directly: a static HTML prototype, a small site, a generated app, a demo running on a sandbox port, or a Work that uses the Cohub SDK to read approved context and request explicit viewer authorization.

This guide is based on the current implementation and a verification run in a clean Space on 2026-06-19.

## What a Work Contains

A Work record belongs to one Space and has a few important fields.

`slug` is the public name used in the URL.

`status` can be `draft`, `published`, or `disabled`.

`targetType` can be `file`, `directory`, or `port`.

`targetRef` is the file path, directory path, or port number.

`workScopes` are permissions the publisher grants directly to the Work.

`allowedViewerScopes` are permissions the Work is allowed to request from each viewer through a consent dialog.

The public URL shape is:

```text
/:username/:spaceSlug/w/:workSlug
```

For example:

```text
/username/works-guide-test-2026-06-19/w/works-guide-file
```

## Publish From the UI

Open a Space and prepare something publishable.

For a single-file Work, create or open an HTML file. The file target must end in `.html` or `.htm`.

For a directory Work, create a directory that contains `index.html`. Relative files such as CSS, JS, images, and JSON can live beside it. The directory is copied as a static public asset set.

For a port Work, start a dev server on a supported public sandbox port, then publish the port from the port preview surface.

Open the file, inline file preview, directory preview, or port preview, then click `Publish`.

The `Publish work` dialog confirms the public address. If the current user has no username, the dialog asks for one. If the Space has no slug, the dialog asks for one. The dialog then asks for the Work slug.

Choose the permissions. Under `Work can`, select the permissions the Work receives directly. Under `Viewers can allow`, select the permissions the Work may ask each viewer to grant later.

Click `Publish`. When publishing succeeds, the dialog shows the public URL and offers `Copy`, `Open`, and `Done`.

The new Work appears in the left sidebar under `Works`. Click the item to open the management page.

## Manage a Work

The Work management page is:

```text
/spaces/:spaceId/works/:workId
```

From that page you can open the public page, edit the slug, target, status, and permissions, disable or publish the Work, delete it, and copy the Work ID.

Disabling a Work removes it from the public by-slug lookup. Deleting a Work removes the management record, viewer grants, and associated published assets.

Changing a published file or directory target refreshes the stored public asset. Changing a Work away from `published` clears the stored asset reference.

## Targets and Limits

File Works only accept HTML files. The published HTML asset must be between 1 byte and 5 MB.

Directory Works must contain `index.html`. The published directory must contain 1 to 1000 files and total 1 byte to 100 MB.

Port Works use the sandbox public endpoint for the port. The port must be one of the supported Cohub public sandbox ports.

The public Work page only serves a Work when its status is `published`.

## Permissions

Current direct Work permissions are:

```text
space.view
session.view
file.view
taskrun.view
```

Current viewer-grant permissions are:

```text
session.prompt.readonly
session.prompt.fullaccess
generation.create
user.space.list
user.session.list
user.usage.read
```

Direct Work permissions are granted by the publisher at publish time.

Viewer-grant permissions require a separate viewer action. The Work calls authorization from inside the runtime, Cohub shows the viewer a consent dialog, and the Work receives a token only for scopes allowed by the publisher and approved by the viewer.

The `user.*` scopes grant access to the viewer's account-level data across all their spaces. `user.space.list` lets the Work call `cohub.spaces.list()`. `user.session.list` lets the Work call `cohub.user.listSessions()`. `user.usage.read` lets the Work call `cohub.user.getUsage()`. These scopes are not bound to the Work's own space.

Use the smallest permission set that the Work needs. A visual static demo normally does not need file, session, task, prompt, or generation permissions.

## Use the SDK Inside a Work

A published Work can use the Cohub SDK from its own HTML/JS.

For no-build HTML, import the SDK from an ESM CDN and create a client:

```js
const { createCohubClient } = await import(SDK_URL);
const cohub = createCohubClient();
const context = await cohub.context();
const space = cohub.space(context.space.id);
```

`cohub.context()` returns Work identity, Space identity, and the current permission scopes.

To call APIs that need Work permissions, use the SDK client after the context is loaded. For example, `space.getConfig()` expects `space.view`; file tree reads expect `file.view`; session list reads expect `session.view`.

To request viewer authorization, call the SDK authorization helper from a user action:

```js
await cohub.auth.request({
  scopes: ["session.prompt.readonly"],
  reason: "This Work wants to read session context for the current viewer."
});
```

Prompt-writing behavior should request `session.prompt.fullaccess`. Generation creation should request `generation.create`.

To access the viewer's account-level data, request the corresponding `user.*` scope:

```js
// List the viewer's spaces
await cohub.auth.request({
  scopes: ["user.space.list"],
  reason: "This Work wants to show your space list.",
});
const spaces = await cohub.spaces.list();

// List sessions the viewer created across all spaces
await cohub.auth.request({
  scopes: ["user.session.list"],
  reason: "This Work wants to list your sessions.",
});
const { sessions } = await cohub.user.listSessions({ limit: 20 });

// Read the viewer's aggregated usage
await cohub.auth.request({
  scopes: ["user.usage.read"],
  reason: "This Work wants to show your usage summary.",
});
const usage = await cohub.user.getUsage(30);
```

The example app in `docs/work-capability-lab/` demonstrates runtime context, token inspection, file reads, session reads, viewer authorization, and prompt calls from inside a published Work.

## Publish Through the API or SDK

The SDK exposes `works.create`, `works.update`, `works.delete`, `works.get`, `works.getBySlug`, and `works.listBySpace`.

Before creating a publicly addressable Work through the API, make sure the owner has a username and the Space has a slug. The API rejects published Works when either public identity part is missing.

Create a single-file Work:

```js
await sdk.works.create({
  spaceId,
  slug: "my-html-demo",
  status: "published",
  targetType: "file",
  targetRef: "demo/index.html",
  workScopes: ["space.view"],
  allowedViewerScopes: ["session.prompt.readonly"]
});
```

Create a directory Work:

```js
await sdk.works.create({
  spaceId,
  slug: "my-site",
  status: "published",
  targetType: "directory",
  targetRef: "site",
  workScopes: ["space.view", "file.view"],
  allowedViewerScopes: []
});
```

Create a port Work:

```js
await sdk.works.create({
  spaceId,
  slug: "live-preview",
  status: "published",
  targetType: "port",
  targetRef: "5173",
  workScopes: ["space.view"],
  allowedViewerScopes: []
});
```

Fetch a public Work by URL parts:

```js
await sdk.works.getBySlug(username, spaceSlug, workSlug);
```

List a Space's Works:

```js
await sdk.works.listBySpace(spaceId);
```

## Verification Run

Verification used a clean Space named `Works Guide Test 2026-06-19`.

The Space ID was:

```text
<space-id>
```

The Space slug was set to:

```text
works-guide-test-2026-06-19
```

The test created `works-guide-demo/index.html` and published it as a file Work with slug `works-guide-file`.

The test created `works-guide-site/index.html` plus `works-guide-site/style.css` and published the directory as a directory Work with slug `works-guide-site`.

Both Works returned `published` status, both had stored assets, both resolved through `/api/works/by-slug/username/works-guide-test-2026-06-19/:workSlug`, and both public frontend URLs returned HTTP 200.

The public asset responses contained the expected page text: `Works Guide Demo` for the file Work and `Directory Work` for the directory Work.

## Common Failure Cases

If the public link cannot be formed, check that the user has a username and the Space has a slug.

If a file Work fails, check that the target is an HTML file and is not empty or larger than 5 MB.

If a directory Work fails, check that the directory contains `index.html`, has at least one file, has no more than 1000 files, and is not larger than 100 MB.

If a Work opens but cannot use Cohub APIs, check its `workScopes` and the viewer-granted scopes shown in `cohub.context()`.

If a viewer authorization request is denied, check that the requested scope is included in `allowedViewerScopes`.

If a published Work should no longer be public, set status to `disabled` or delete it from the Work management page.
