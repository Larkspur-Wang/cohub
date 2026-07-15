# Security Policy

## Supported versions

Security fixes are applied on the `main` branch of this repository.

## Reporting a vulnerability

Please report security issues privately. Do **not** open a public GitHub issue for vulnerabilities that could expose user data, credentials, sandbox escape paths, or remote code execution.

### Preferred channels

1. **GitHub Private Vulnerability Reporting** on this repository (Security tab → Report a vulnerability), when available.
2. **Email**: [dev@talesof.ai](mailto:dev@talesof.ai)

If neither channel is reachable, contact [47@nieta.art](mailto:47@nieta.art) with the subject prefix `[SECURITY]`.

### What to include

- a clear description of the issue
- affected component / version / commit when known
- steps to reproduce
- impact assessment
- any suggested fix, if available

### Response targets

We aim to:

- acknowledge valid reports within **3 business days**
- provide an initial severity assessment within **7 business days**
- keep reporters updated until the issue is fixed or declined

Please give us a reasonable window to investigate and ship a fix before public disclosure. Coordinated disclosure is preferred.

### Scope notes

In-scope examples:

- authentication / authorization bypass
- data exposure across Spaces, Sessions, Works, or users
- sandbox isolation failures
- secret leakage in logs, debug bundles, or releases
- remote code execution in API, Agent, Worker, Gateway, or Web

Out of scope examples:

- denial of service without a security impact
- social engineering against Cohub staff or users
- issues that only affect outdated forks or heavily customized self-hosted deployments
