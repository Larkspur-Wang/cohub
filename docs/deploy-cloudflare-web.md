# Cloudflare Web Deployment Notes

## Required

- Cloudflare Worker project for Cohub Web
- `BFF_ORIGIN` pointing to the Hono API, for example `https://api.cohub.run`

## Deploy

```bash
pnpm -C apps/web build
pnpm -C apps/web wrangler deploy
```
