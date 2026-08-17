---
name: public-share
description: Upload files or directories as public, space-scoped URLs.
---

# Public Share

Use this skill when a user wants a file, static page, or directory to be publicly accessible by URL.

Public files are isolated by Space under the short `/p/{spaceId}/...` URL namespace. Use the current Space unless the user specifies another one.

## Publish

Upload one file or one directory:

```bash
cohub public upload <source> [destination]
```

Examples:

```bash
cohub public upload ./report.pdf
cohub public upload ./report.pdf reports/latest.pdf
cohub public upload ./dist demo
```

For a directory containing `index.html`, the command returns its public URL. Otherwise it prints the directory's CDN URL prefix so individual file URLs can be formed without another CLI call. The prefix itself is not a browsable directory.

Use `--json` to receive the destination, Space CDN URL prefix, and a complete manifest containing every uploaded file's path, size, and MIME type. Concatenate `urlPrefix` and a file's `path` to form its public URL.

Existing files are never replaced implicitly. When replacement is intended, use:

```bash
cohub public upload <source> [destination] --overwrite
```

The command clearly declares overwrite mode before uploading. Without `--overwrite`, object storage rejects any write to an existing path.

## Inspect

```bash
cohub public ls [path]
cohub public ls -r [path]
cohub public url <path>
```

Read or preview content through its public URL. Do not copy it into `/public`.

## Safety

- Review content before making it public.
- Never upload secrets, tokens, private logs, or internal-only files.
- Use relative asset paths in static sites.
- Use `--overwrite` only when replacing the existing public path is intentional.

## Finish

Return the direct public URL when the command provides one.
