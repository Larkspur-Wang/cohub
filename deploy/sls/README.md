# Cohub SLS / LoongCollector

Cohub 应用日志统一输出为 JSON Lines 到容器 stdout/stderr，由 ACK 中已安装的 LoongCollector 采集到 SLS。

## 目标映射

| Kubernetes namespace | SLS project | SLS logstore | 配置 |
| --- | --- | --- | --- |
| `cohub-dev` | `cohub` | `cohub-dev` | `deploy/sls/cohub-dev.yaml` |
| `cohub` | `cohub` | `cohub-prod` | `deploy/sls/cohub-prod.yaml` |

## CRD

当前按新版 `ClusterAliyunPipelineConfig` 编写：

```bash
kubectl get crd | grep -i clusteraliyunpipelineconfig
```

配置使用 `input_container_stdio` 采集容器标准输出，并通过 `ContainerFilters` 限定 namespace 与容器名。应用结构化日志统一写入 stdout；stderr 暂不采集，避免 stdout/stderr 双流乱序。Node 运行时崩溃等 stderr 输出如需采集，可单独增加一份非 JSON fallback 配置。

如集群中的 group/version 与 YAML 不一致，请以集群实际 CRD 为准调整 `apiVersion`。

## 日志格式

应用侧字段示例：

```json
{
  "timestamp": "2026-05-29T12:00:00.000Z",
  "level": "info",
  "service": "cohub-api",
  "env": "prod",
  "version": "v0.6.8",
  "hostname": "cohub-api-xxx",
  "message": "request failed",
  "request_id": "...",
  "trace_id": "...",
  "span_id": "..."
}
```

## 推荐索引字段

建议在 `cohub-dev` / `cohub-prod` 开启这些字段索引：

- `timestamp`
- `level`
- `message`
- `service`
- `env`
- `version`
- `hostname`
- `request_id`
- `trace_id`
- `span_id`
- `component`
- `space_id`
- `session_id`
- `turn_id`
- `job_id`
- `task_type`
- `channel_id`
- `provider`
- `model`
- `tool_name`
- `error.name`
- `error.message`

## 验证

先 server dry-run：

```bash
kubectl apply --dry-run=server -f deploy/sls/cohub-dev.yaml
kubectl apply --dry-run=server -f deploy/sls/cohub-prod.yaml
```

再先应用 dev：

```bash
kubectl apply -f deploy/sls/cohub-dev.yaml
```

确认 SLS `cohub / cohub-dev` 可查询到日志后，再应用 prod：

```bash
kubectl apply -f deploy/sls/cohub-prod.yaml
```

常用查询：

```text
service: cohub-api AND env: dev AND level: error
trace_id: "..."
request_id: "..."
```
