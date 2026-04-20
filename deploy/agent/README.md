# Agent 部署约定（当前架构）

本文档描述 `apps/agent` 在当前 ownership + 多 space 控制面架构下的部署角色与约定。

## 角色定位

`apps/agent` 是控制面服务，职责包括：

- 运行 `pi-coding-agent`
- 管理 session / persistence / Redis I/O
- 基于 ownership 处理 owner-routed 输入
- 主动发现并连接各个 sandbox 的 WebSocket server
- 将 tool 调用通过 ws rpc 转发给对应 space 的 sandbox
- 在 sandbox 可用后调用 sandbox 准备流程
- 在 prepare 成功后上报 `space_sandboxes.status=ready`

## 运行模型

- agent 为独立 Deployment（可多副本）
- sandbox 为按 space 动态创建的 Pod
- 同一 `spaceId` 任意时刻只归一个 owner agent 实例
- agent 需要挂载整个 workspace PVC 的环境子路径
- session 由 agent 管理，并持久化到同一个 PVC 的 sessions 子路径

## Agent 关键环境变量

- `REDIS_URL`
- `WORKSPACE_ROOT`
- `SESSIONS_DIR`
- `ENV`
- `WORKER_SECRET`
- `AGENT_VERSION`

本地调试可额外使用：
- `LOCAL_SANDBOX_SPACE_ID`
- `LOCAL_SANDBOX_WS_URL`

## 共享 PVC 路径规划

统一使用同一个 PVC，例如：

```txt
cohub-spaces-pvc
```

PVC 内推荐目录布局：

```txt
/workspaces/dev/{spaceId}/workspace
/workspaces/prod/{spaceId}/workspace
/sessions/dev/spaces/{spaceId}/...
/sessions/prod/spaces/{spaceId}/...
```

## Agent 当前模板约定

### Dev

- Deployment: `cohub-agent-dev`
- Namespace: `cohub-dev`
- workspace PVC: `cohub-spaces-pvc`
- workspace mountPath: `/space-storage`
- workspace subPath: `workspaces/dev`
- `WORKSPACE_ROOT=/space-storage`
- sessions mountPath: `/sessions`
- sessions subPath: `sessions/dev`
- 最终 session 实际目录：`/sessions/spaces/{spaceId}/...`

### Prod

- Deployment: `cohub-agent`
- Namespace: `cohub`
- workspace PVC: `cohub-spaces-pvc`
- workspace mountPath: `/space-storage`
- workspace subPath: `workspaces/prod`
- `WORKSPACE_ROOT=/space-storage`
- sessions mountPath: `/sessions`
- sessions subPath: `sessions/prod`
- 最终 session 实际目录：`/sessions/spaces/{spaceId}/...`

## 说明

这样设计后：

- sandbox 挂自己的 `/workspace`，并额外挂载只读 `/configs/platform/.agents`
- agent / api / worker 都按环境挂载共享 PVC 的对应环境子树
- workspace 与 sessions 仍在同一个 PVC 中，但路径分区清晰，不混用
