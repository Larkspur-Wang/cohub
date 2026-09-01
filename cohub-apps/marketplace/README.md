# Marketplace

A standalone first-party Cohub App for discovering and installing Apps.

The App uses `cohub.context()` and takes `invocation.spaceId` as its initial Space. It requests the existing `file.view` and `file.edit` scopes for that Space, reads `.cohub/apps.json`, and writes validated marketplace entries back with the current file revision. It does not introduce a separate App-management permission.

## Develop

```bash
cd cohub-apps/marketplace
npm install
npm run dev
```

Runtime context and authorization are only available inside a published Cohub App. Build and test locally with:

```bash
npm run check
```

## Publish

```bash
npm run build
cohub apps publish marketplace \
  --dir dist \
  --app-scope file.view \
  --app-scope file.edit \
  --hide-cohub-bar
```

The main workspace injects this App's ID through `PUBLIC_MARKETPLACE_APP_ID` at build time. Each environment should publish and configure its own Marketplace App and catalog.
