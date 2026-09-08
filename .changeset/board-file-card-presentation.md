---
"@neta-art/cohub": minor
---

Board file cards read better: titles come from frontmatter (`title`/`name`/`label`/`heading`) or the first H1 and drop the file extension; frontmatter is split reliably (BOM, leading blanks, `+++` TOML, trailing fence whitespace); covers accept more keys including nested `image.src`; excerpts vary by file kind (prose for docs, leading comment for code, `description` for JSON/YAML). Cards show a `TYPE · size` meta line, a category-coloured stripe, and a large type mark when there is no cover or excerpt.
