# Workspace API（Hono BFF）部署参数收集表

请填写以下参数后回传给我，我会据此完成最终部署。

## 1) 必填参数

| 参数 | 你填写的值 | 说明 |
| --- | --- | --- |
| `NAMESPACE` | `netaverses` | 与 gitea 同 namespace |
| `APP_NAME` | `netaverses-api` | API 服务名（Deployment/Service 等资源名） |
| `IMAGE_REPOSITORY` |  | 镜像仓库地址 |
| `IMAGE_TAG` |  | 镜像版本 |
| `AUTH_BASE_URL` |  | 现有鉴权服务 base URL |
| `GITEA_BASE_URL` |  | gitea 对外 URL |
| `WEB_ORIGIN` |  | 前端域名（Cloudflare Web 域名） |
| `API_HOSTNAME` |  | API 对外域名（用于 HTTPRoute） |

## 2) 可选参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `IMAGE_PULL_SECRET` | 空 | 私有镜像仓库拉取密钥名 |
| `GITEA_TOKEN` | 空 | 访问私有仓库时需要；仅 public 可留空 |
| `TOKEN_COOKIE_NAME` | `x_token` | 登录 cookie 名称 |
| `REPLICAS` | `2` | 初始副本数 |
| `REQUEST_CPU` | `100m` | 资源请求 |
| `REQUEST_MEMORY` | `128Mi` | 资源请求 |
| `LIMIT_CPU` | `500m` | 资源上限 |
| `LIMIT_MEMORY` | `512Mi` | 资源上限 |

## 3) 你需要实际填写的文件

- `deploy/api/values.yaml`
- `deploy/api/secrets.yaml`

填好后我会帮你继续执行：
1. `deploy/api/check-config.sh`
2. `deploy/api/deploy.sh`
3. 部署后健康检查与连通性验证
