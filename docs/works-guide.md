# Cohub Works Guide

Works are published, shareable surfaces that turn a Space file, directory, or public sandbox port into a public Cohub page.

Use Works when a Space produces something people should open directly: a static HTML prototype, a small site, a generated app, a demo running on a sandbox port, or a Work that uses the Cohub SDK to read approved context and request explicit viewer authorization.

## Runtime requirements

`cohub.context()`, `cohub.auth.*`, and `cohub.app.commerce.*` only function inside a **published** Work — the Cohub-hosted iframe where `window.parent` is the Cohub shell. They do not work from a static asset URL or a local preview. In those environments `context()` is `null` and commerce calls fail. Always develop against a published Work.

## What a Work Contains

A Work record belongs to one Space and has a few important fields.

`slug` is the public name used in the URL.

`status` can be `published` or `disabled`.

`targetType` can be `file`, `directory`, or `port`.

`targetRef` is the file path, directory path, or port number.

`workScopes` (`appScopes` in the canonical API) are permissions the publisher grants directly to the Work for its own Space.

`allowedViewerScopes` is deprecated: viewer grants are no longer gated by the app configuration. A viewer may grant any permission they can already use themselves on the target Space.

The public URL shape is:

```text
/:username/:spaceSlug/w/:workSlug
```

For example:

```text
/username/works-guide-test-2026-06-19/w/works-guide-file
```

Query parameters and the URL fragment on a public Work link are forwarded to
embedded web and port Works. This supports shareable application state such as
`?view=timeline#today`. Parameters in the `cohub_*` namespace are reserved for
the Cohub host and are available only through their documented SDK APIs. Do not
put secrets or access tokens in a Work URL.

## Publish From the UI

Prepare something publishable in a Space: an HTML page, a `.board` file, any other single file, a directory containing `index.html` with relative assets, or a running dev server on a supported public sandbox port.

Open the file, directory, or port preview, then click `Publish`. The dialog asks for a Work slug (and a username or space slug if missing). Under `App can`, select the permissions the app receives directly for its own Space.

After publishing, the dialog shows the public URL. The Work also appears in the left sidebar under `Works`.

## Manage a Work

The Work management page is:

```text
/spaces/:spaceId/works/:workId
```

From that page you can open the public page, edit the slug, target, status, and permissions, disable or publish the Work, update its published version, delete it, and copy the Work ID.

Disabling a Work removes it from the public by-slug lookup. Publishing or updating a version creates a fresh snapshot from the current target. Deleting a Work removes the management record, viewer grants, and version records.

Editing a target changes the source used by the next version. The public page changes only after publishing or updating a version.

## Targets and Limits

File Works accept any single file up to 1 GiB. An HTML page (`.html` / `.htm`) is published as a web page. A `.board` file is published as an interactive read-only Board, together with the assets it references. Any other file is published for native preview (Markdown, code, image, video, audio, PDF) with a download fallback.

A Board publish captures the Board's own state plus the workspace files it actually references — images, videos, file-card covers, and effect or clip assets. Files a Board does not reference are never published, and file cards show the preview captured at publish time rather than the whole target file.

Directory Works must contain `index.html`. The published directory must contain 1 to 1000 files and total 1 byte to 1 GiB.

Port Works use the sandbox public endpoint for the port. The port must be one of the supported Cohub public sandbox ports.

The public Work page only serves a Work when its status is `published`.

## Permissions

An app's effective permission for one Space is the union of two grant sources — either one is enough:

- **App-side grant** — a bounded publisher grant (`space.view`, `session.view`, `file.view`, `file.edit`, `taskrun.view`, `session.prompt.readonly`, `session.prompt.fullaccess`, `command.execute`) that applies only to the app's own Space. No viewer consent needed; the server resolves it live on every request.
- **Viewer grant** — a viewer consents through a dialog. A viewer may grant **any** permission on **any** Space they choose, with two hard rules enforced by the server:
  - At grant time the viewer must currently hold every requested permission on the target Space.
  - At use time the grant only works while the viewer still holds that permission there — losing a membership or a role downgrade takes effect immediately.

Account-level scopes (`user.space.list`, `user.session.list`, `user.taskrun.list`, `user.usage.read`) always require a viewer grant; a publisher can never pre-grant them via `appScopes`.

Direct publisher grants are limited to:

```text
space.view  session.view  file.view  file.edit
taskrun.view  session.prompt.readonly  session.prompt.fullaccess
command.execute
```

Generation, member/Sandbox/Commerce management, and account-level scopes always require a viewer grant.

Viewer grants are per Space: one viewer can hold a different grant for the app's own Space and for each Space they picked. The consent dialog shows the target Space name, resolved by Cohub — never by the app.

Viewer-granted permissions never inherit the publishing app's Space access: `taskrun.view` granted for Space A lists Task Runs in Space A only — re-validated against the viewer's current access there. The separate `user.taskrun.list` account scope exposes only Task Runs owned by the viewer.

The `user.*` scopes grant access to the viewer's account-level data across all their spaces. `user.space.list` lets the app call `cohub.spaces.list()`. `user.session.list` lets the app call `cohub.user.listSessions()`, which returns recent sessions the viewer can already view as themselves. `user.taskrun.list` lets the app list and read every Task Run owned by the viewer through the unscoped `cohub.tasks.list()`, including runs from Spaces they can no longer access and account-level runs. `user.usage.read` lets the app call `cohub.user.getActivity()`. Listing Spaces does not grant access to them — the app still needs a grant for each Space it touches; likewise `user.taskrun.list` shows owned Task Runs but grants no access to their source Spaces or to other users' runs.

Grants last 14 days; tokens last 1 hour. Tokens carry identity, publisher scopes, and a display-only snapshot of the consented scopes (`viewerScopes`, for legacy clients that decode the JWT) — consent state lives in the grant rows and is resolved on every request, so tokens stay constant-size and revoking a grant takes effect immediately. Silent reuse only renews a live grant that still covers the requested scopes: it can never create, widen, or revive a grant, so a revoked grant stays revoked until the viewer consents again in a dialog:

```bash
cohub apps grants <app>            # list your grants for an app
cohub apps revoke <app> <grantId>  # revoke one
```

Use the smallest permission set that the Work needs. A visual static demo normally does not need file, session, task, prompt, or generation permissions.

## Use the SDK Inside a Work

A published Work can use the Cohub SDK from its own HTML/JS.

For no-build HTML, import the SDK from an ESM CDN and create a client:

```js
const { createCohubClient } = await import(SDK_URL);
const cohub = createCohubClient();
const context = await cohub.context();
const spaceId = context.invocation?.spaceId ?? context.app.homeSpace?.id ?? context.space.id;
const space = cohub.space(spaceId);
```

`cohub.context()` returns App identity, App home Space identity, and the current permission scopes. For a new chat background, the Space currently hosting the App is available as `context.invocation.spaceId`; `context.space` remains the legacy App home Space field.

To call APIs that need App permissions, use the SDK client after the context is loaded. For example, `space.getConfig()` expects `space.view`; file tree reads expect `file.view`; session list reads expect `session.view`.

To request viewer authorization, call the SDK authorization helper from a user action:

```js
await cohub.auth.request({
  scopes: ["session.prompt.readonly"],
  reason: "This Work wants to read session context for the current viewer."
});
```

Prompt-writing behavior should request `session.prompt.fullaccess`. Generation creation should request `generation.create`.

To ask for access to one of the viewer's other Spaces, let the viewer pick it — `requestSpace` merges the choice and the grant into one consent dialog. The host loads the space list (the app never sees it) and the result carries the picked Space:

```js
const { granted, space } = await cohub.auth.requestSpace({
  scopes: ["file.view", "session.view"],
  reason: "This app reads the Space you pick.",
});
if (granted && space) {
  const picked = cohub.space(space.id);
}
```

When the app already knows the target Space, pass its id instead — the dialog then only confirms that Space:

```js
await cohub.auth.request({
  scopes: ["file.view", "session.view"],
  spaceId: pickedSpace.id,
  reason: "This app reads the Space you picked.",
});
```

`cohub.context().permissions` reports `viewerGrants` (the per-space viewer consents — previously granted ones included), plus flat `scopes` / `appScopes` / `viewerScopes` for compatibility.

### Silent reuse vs. asking again

Apps never cache grants themselves — the host does. Every `auth.request` call reuses a previous grant silently (for 14 days after the viewer last confirmed) and only opens the consent dialog when something new is needed. To force a fresh dialog instead — re-confirming a grant, or letting the viewer switch to another Space — pass `alwaysAsk`:

```js
// Silent-first: no dialog when a grant already covers the scopes.
await cohub.auth.request({ scopes: ["file.view"] });

// Always show the dialog, even when a grant covers the scopes.
await cohub.auth.request({ scopes: ["file.view"], alwaysAsk: true });

// The picker equivalent: always let the viewer pick again.
await cohub.auth.requestSpace({ scopes: ["file.view"], alwaysAsk: true });
```

`cohub.context().permissions.viewerGrants` reflects what the viewer previously granted, so apps can render their state without triggering anything.

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

// Read the viewer's activity
await cohub.auth.request({
  scopes: ["user.usage.read"],
  reason: "This Work wants to show your activity.",
});
const activity = await cohub.user.getActivity({ days: 30 });
```

For commerce inside a Work — feature unlocks and credit consumption:

```js
// Check entitlements and credit balance in one call
const { entitlements, credits } = await cohub.app.commerce.getEntitlements();

// Feature unlock: purchase if not entitled
const unlocked = entitlements.some((e) => e.benefitKey === "space_pro" && e.enabled);
if (!unlocked) {
  await cohub.app.commerce.purchase({ productKey: "pro_unlock" });
}

// Credit consumption: consume for a metered action
const result = await cohub.app.commerce.consumeCredits({
  amount: 10,
  operationId: crypto.randomUUID(),
  reason: "Export high-res image",
});
if (result.status === "insufficient") {
  await cohub.app.commerce.purchase({ productKey: "credit_pack" });
}

// After checkout return, query the order
const checkoutState = await cohub.app.commerce.getCheckoutState();
if (checkoutState.orderId) {
  const { order } = await cohub.app.commerce.getOrder(checkoutState.orderId);
}
```

The example app in `docs/examples/work-capability-lab/` demonstrates runtime context, token inspection, file reads, session reads, viewer authorization, prompt calls, account-level data access, and a minimal commerce flow from inside a published Work.

For a focused commerce example, see:

- `docs/work-commerce-guide.md`
- `docs/examples/work-capability-lab/commerce-demo.md`
- `docs/examples/work-capability-lab/commerce-demo.html`

## Preview a Work Inside the Workspace

A Work detail page offers two ways to open the published result:

- **Preview** shows the Work as a tab in the workspace preview pane, beside the
  detail page, so publish settings and the running Work stay visible together.
- **New tab** opens the public Work page as before.

The preview tab is keyed by Work id, deep-linkable as `?preview=work:<workId>`,
and participates in the same tab budget as file, Board, and port previews.

## Let an Agent Drive the Preview

An Agent running in the Space can open the same preview in the Cohub tab the chat
started from, and call methods the Work exposes:

```bash
cohub desktop open <workId|url|cohub://works/...|username/space/work>
cohub desktop open <work> --call selection.get
cohub desktop open <work> --call board.focus --data '{"nodeId":"n1"}'
```

Register a method that receives the UI command id and completes it later:

```ts
client.app.surface.handle("image.open", async (input, { commandId }) => {
  openImageStudio(input, commandId);
});

await client.ui.reportResult(commandId, {
  status: "applied",
  result: selectedImage,
  error: null,
});
```

Only registered methods are reachable, so a Work decides exactly what an Agent can
do. There is no DOM access and no script evaluation. Commands are routed by request
provenance and reach only the frontend instance that originated the work, so they
cannot touch another user's browser. A Work also answers only a Cohub app origin,
so embedding it elsewhere cannot invoke its methods. Native file and Board Works can
be previewed but expose no callable surface.

## Promote a Work

Work editors can create immutable promotion links for paid or owned traffic. `generic` records local landing and readiness analytics without loading third-party code. `meta` adds the deployment-configured Meta Pixel and Conversions API provider.

```bash
cohub apps promotions create <work> \
  --name "Meta launch video A" \
  --provider meta \
  --utm-source instagram \
  --utm-medium paid_social \
  --utm-campaign launch_2026 \
  --utm-content video_a
```

List links and inspect one promotion's aggregate statistics:

```bash
cohub apps promotions list <work>
cohub apps promotions stats <work> <promotion-id>
```

Promotion links always open the current published Work. Statistics retain the immutable Work version that served each event. Hourly counts cover landing, readiness, registration, purchase-confirmation, and checkout-start events; Cohub does not retain visitor-level promotion records.

The browser keeps a 30-day, Work-scoped last-touch attribution in local storage so authentication and checkout redirects preserve the Promotion. Configured providers receive Work ready, first Cohub registration, purchase-confirmation shown, and usable-checkout-created events. Meta maps these to `ViewContent`, `CompleteRegistration`, `AddToCart`, and `InitiateCheckout`. Checkout uses the existing purchase attempt id as the shared Pixel/CAPI event id; paid-order Purchase delivery is deferred until Billing exposes a reliable OrderPaid event or outbox trigger.

The `generic` provider is always available. A deployment enables `meta` by configuring `COHUB_META_PIXEL_ID` and `COHUB_META_CAPI_ACCESS_TOKEN`; `COHUB_META_API_VERSION` defaults to `v21.0`. Set `COHUB_META_CLIENT_IP_HEADER` only when the edge overwrites that header with the trusted public client IP (for example, `cf-connecting-ip`); otherwise Cohub uses the direct socket address and omits private addresses.

## View Statistics

Work editors can inspect total, 24-hour, 7-day, and 30-day views with a source breakdown:

```bash
cohub apps stats <workId|url|username/space/work>
```

Use `--json` to include the 30-day daily trend.

## Download Published Artifacts

Newly published file and directory Works include an immutable artifact manifest. Download them by id, public URL, mention URI, or public slug reference:

```bash
cohub apps download <workId|url|username/space/work> --output <path>
```

The CLI reads the small manifest, streams files directly from the CDN with bounded concurrency, verifies every SHA-256 checksum, and atomically restores the published artifact. Existing outputs are never overwritten. An HTML file with published companion assets is restored as a directory bundle so no artifact files are lost. Board and port Works are not downloadable because neither maps safely to a restorable file or directory artifact.

## Publish Through the API or SDK

The SDK exposes `works.create`, `works.update`, `works.publishVersion`, `works.delete`, `works.get`, `works.getBySlug`, `works.getStats`, and `works.listBySpace`.

`works.get(workId)` returns the Work record plus `publicUrl`, `content`, `owner`, and `space` when the Work can be publicly resolved.

Before creating a Work through the API, make sure the owner has a username and the Space has a slug. The API rejects Works when either public identity part is missing.

Usernames and Space slugs can be set or changed, but they cannot be cleared once set.

Create a single-file Work:

```js
await sdk.works.create({
  spaceId,
  slug: "my-html-demo",
  status: "published",
  targetType: "file",
  targetRef: "demo/index.html",
  workScopes: ["space.view"]
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
  workScopes: ["space.view", "file.view"]
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
  workScopes: ["space.view"]
});
```

Fetch a public Work by URL parts:

```js
await sdk.works.getBySlug(username, spaceSlug, workSlug);
```

Update the published version from the current target:

```js
await sdk.works.publishVersion(workId);
```

List a Space's Works:

```js
await sdk.works.listBySpace(spaceId);
```

Fetch a Work's view statistics:

```js
await sdk.works.getStats(workId);
```

## Verification

This guide was verified in a clean Space on 2026-06-19. File and directory Works both published successfully, resolved through the by-slug API, and served the expected HTML over HTTPS.

## Common Failure Cases

If the public link cannot be formed, check that the user has a username and the Space has a slug.

If a file Work fails, check that the target is between 1 byte and 1 GiB. If a Board Work fails, check that the `.board` file is valid and references at most 1000 assets totalling at most 1 GiB.

If a directory Work fails, check that the directory contains `index.html`, has 1 to 1000 files, and totals at most 1 GiB.

If a Work opens but cannot use Cohub APIs, check that it is running inside a published Work iframe — static asset URLs and local previews do not provide the Work runtime. If it is, check its `workScopes` and the viewer-granted scopes shown in `cohub.context()`.

If a viewer authorization request fails, check that the viewer currently holds every requested permission on the target Space — grants are limited to what the viewer can already do there themselves.

If account-level data calls (`spaces.list()`, `user.listSessions()`, `user.getActivity()`) return 403, the viewer must first grant the corresponding `user.*` scope via `cohub.auth.request()`.
