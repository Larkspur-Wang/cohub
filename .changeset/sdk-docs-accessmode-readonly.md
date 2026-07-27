---
"@neta-art/cohub": patch
---

Docs: clarify `accessMode` in the Work Runtime Guide to prevent read-only 403s.

The permission table and all `space.prompt()` examples only showed full-access
prompts, with no mention that `session.prompt.readonly` requires
`accessMode: "read_only"` in the call. Since the backend defaults `accessMode`
to `full_access`, requesting only `session.prompt.readonly` and reusing the
example code (no `accessMode`) yielded a 403.

- Split the "Send a prompt" table row into full-access / read-only rows that
  name the `accessMode` parameter explicitly.
- Add an `accessMode`-default warning and a complete read-only prompt recipe
  (auth.request + space.prompt + subscribeGeneration) to the LLM chat section.
- Add a pitfalls checklist item for scope / `accessMode` mismatch.
