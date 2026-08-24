# Product docs

Product documentation rendered at `/docs` by `apps/web`.

```text
docs/product/
  en/                 # English source (default locale, no /en prefix in URL)
  zh/                 # Chinese source → /zh/docs
```

## URL map

| Locale | Home | Page |
| --- | --- | --- |
| English | `/docs` | `/docs/learn/quick-start` |
| Chinese | `/zh/docs` | `/zh/docs/learn/quick-start` |

## Rules

- English is the default locale; URLs do not include `/en`
- Chinese lives under `/zh/docs`
- Keep copy concise and product-oriented
- Use UI terms first (Chat, Save); mention API names when needed
- Keep the same file tree and slugs across locales
- Internal links must use the correct locale prefix (`/docs/...` or `/zh/docs/...`)
- Add pages to `apps/web/src/lib/docs/manifest.ts` when introducing a new doc
- Localize nav titles in the same manifest maps

## Local preview

```bash
pnpm --filter web dev
# open /docs and /zh/docs
```
