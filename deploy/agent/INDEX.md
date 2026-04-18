# Cohub Agent 部署

## 目录结构

```text
deploy/agent/
├── manifests/
│   ├── deployment.tmpl.yaml
│   └── service.tmpl.yaml
├── prod/
│   ├── values.yaml
│   └── secrets.template.yaml
└── dev/
    └── values.yaml
```

更详细的长期架构说明见：

- `deploy/agent/README.md`
- `docs/agent-sandbox-runtime.md`
- `docs/prod-deploy-checklist.md`
