# Contributing

Thanks for contributing to Cohub.

## Development

```bash
pnpm install
pnpm dev
```

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Guidelines

- Prefer small, focused changes.
- Keep UI copy in English.
- Do not commit secrets, real deploy values, or private registry tokens.
- Copy `deploy/**/values.example.yaml` to `values.yaml` for local deploy experiments.
- Billing is optional. Leave `TALESOFAI_BILLING_*` unset to run with billing disabled.

## Pull requests

1. Describe the problem and the approach.
2. Note any follow-up work.
3. Ensure lint and typecheck pass.
