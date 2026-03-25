# Cloudflare Web Deployment Notes

## Required

- Cloudflare Worker project for Cohub Web
- `PUBLIC_API_ORIGIN` set at build time for the target environment, for example `https://api.cohub.run`

## Deploy

```bash
pnpm -C apps/web build
pnpm -C apps/web wrangler deploy
```
