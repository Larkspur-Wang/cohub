# Cohub Search

`cohub-search` is the standalone Tantivy indexer used by sandbox workspaces.
It owns the index writer and exposes a small HTTP API over a Unix socket.
The current provider is `workspace.candidates`: it returns candidate paths for
exact `rg` verification, rather than replacing grep semantics.

## Local usage

```bash
cargo run -- serve \
  --workspace /path/to/workspace \
  --index /tmp/cohub-search-index \
  --socket /tmp/cohub-search/search.sock

curl --unix-socket /tmp/cohub-search/search.sock http://localhost/status
curl --unix-socket /tmp/cohub-search/search.sock -X POST http://localhost/index/full
curl --unix-socket /tmp/cohub-search/search.sock \
  -H 'content-type: application/json' \
  -d '{"literals":["workspace"],"limit":20}' \
  http://localhost/query
```

The index stores workspace-relative paths and lower-cased 3-gram content. It is
used to produce candidate paths; `rg` remains responsible for exact matching,
line numbers, context, and regular-expression semantics.

## API

- `GET /healthz`
- `GET /status` (family, generation, schema, analyzer, coverage)
- `POST /index/full` (manual or recovery fallback)
- `POST /index/reconcile` (compare the persistent file snapshot with the workspace)
- `POST /index/update` with `{ "changes": [...] }`
- `POST /query` with `{ "literals": [...], "pathPrefix": "", "glob": "...", "limit": 1000 }`

Search literals must contain at least 3 non-whitespace characters. The
service default socket directory is private (`0700`) and the socket is
`0600`.

Incremental updates are coalesced for three seconds before a Tantivy commit.
The index directory contains a manifest with the family, generation, schema,
analyzer version, and a persistent file snapshot. Restart reconciliation uses
file metadata first, so a valid index is reused without rereading every file.
Full builds remain available for first creation and recovery. Future index
families can live beside `workspace.candidates` without changing this
provider's contract.

The indexer skips binary files, files larger than 4 MiB, VCS metadata, common
package-manager directories, and build/cache output.
