# Local Runtime / 本地 Runtime

## Execution / 执行

A Space has one local Runtime connection. Users select a Harness, not a machine.
一个 Space 绑定一个本地 Runtime，用户选择 Harness，不选择设备。

```bash
cohub auth login
cohub runtime up ./project --harness pi --harness codex
cohub runtime up ./project --space <space-id> --harness codex
cohub spaces prompt "Continue / 继续" --harness codex
cohub runtime status --space <space-id>
```

`runtime up` replaces `sandbox up`. It supervises the workspace bridge and the
Harness connection. Node.js 24+ is required. Pi and Codex must already be installed and authenticated
locally. `--pi` and `--codex` override executable paths. Repeated `--harness`
options and comma-separated values are accepted. `--yes` accepts the explicit
local execution consent for non-interactive startup.

`runtime up` 替代 `sandbox up`，统一托管工作区连接与 Harness 连接，需要 Node.js 24+。本机需要已安装并登录
Pi / Codex；可通过 `--pi`、`--codex` 指定程序路径。`--harness` 可重复或使用逗号分隔。
非交互启动需要使用 `--yes` 明确同意本机执行权限。

## Shared Pipeline / 统一链路

```text
API prompt -> BullMQ -> Session lock -> Harness dispatch
                                      |-- Cohub runtime
                                      `-- Gateway WS -> local Pi RPC / Codex app-server

Harness events -> Agent sendOutput -> existing snapshot / patch -> Web / SDK
Harness messages -> existing persistence / finalize -> DB / realtime
Native session -> end-of-turn object archive -> turn.harnessIndex
```

There are no HTTP polling/claim/result endpoints. The outbound local connection
uses `/runtime/relay`; internal Agent peers use `/internal/runtime-relay/:spaceId`.
The existing workspace relay remains responsible for files and processes.

不再提供 HTTP 轮询领取或结果回传接口。本地主动连接 `/runtime/relay`；Agent 服务通过
`/internal/runtime-relay/:spaceId` 接入。文件与进程操作仍复用原有工作区 relay。

The same Session lock and queue serialize cloud and local execution. Different
Harnesses, actors or configurations are never merged into the same execution
batch. Local model usage is recorded but is not charged again as a cloud turn.

Cloud / Local 共用 Session 锁和队列。不同 Harness、执行身份或配置不会合并执行。
本地模型用量可记录，但不会再次按云端 turn 收费。

## Resume / 恢复

- Hot resume exchanges only the context revision and new input.
  热会话只交换上下文版本与新输入。
- A missing or outdated projection requests history over the same WS connection.
  本地投影缺失或过期时，通过同一 WS 连接按需请求历史。
- Same-Harness native files are validated and reused. A matching archive can
  restore a missing native file. Cross-Harness handoff compiles durable messages
  into Pi context or an explicitly marked Codex history transcript.
  同 Harness 优先校验并复用原生文件，缺失时可从匹配归档恢复；跨 Harness 根据持久消息
  生成 Pi 上下文或明确标注来源的 Codex 历史文本。
- Codex paginated threads depend on a private SQLite index. Archive import creates
  a separate legacy-history projection and uses native `thread/fork(path)`;
  the original archive and thread are preserved. The private database is never uploaded.
  Codex 分页历史依赖本机 SQLite 索引。归档导入会创建独立的 legacy-history 投影，
  再通过原生 `thread/fork(path)` 恢复；不修改原始归档或 thread，也不上传私有数据库。
- Cloud uses the same history reader, including fork segments and compaction
  boundaries. History reconstruction never executes old tools.
  Cloud 共用历史读取逻辑，包含分支与压缩边界；恢复上下文不会执行历史工具。

Local bookkeeping is under `~/.local/state/cohub/runtime/<space-id>`; native
credentials and configuration remain in the original Harness locations. Existing
files are not overwritten when they contain unconfirmed or externally modified
history. Native archives use the existing turn object storage and URL policy.

本地状态位于 `~/.local/state/cohub/runtime/<space-id>`，凭据和配置仍由原生 Harness 管理。
发现未确认记录或外部修改时，不覆盖原文件。原生归档沿用现有 turn 对象存储和 URL 策略。

## Runtime Recovery / Runtime 恢复协调

Recovery is automatic and Space-scoped. Gateway requests immediate reconciliation
on connection. A single durable schedule in the existing Agent queue checks active
local executions every minute, using a partial index, even if Gateway or Agent crashes
without a disconnect notification. Session locks isolate live work; held locks are
revisited on the next sweep. Settled executions are excluded from the index and sweep.
`turn.recover` is internal and reads saved results only, without starting Harnesses
or replaying tools. Recovery does not depend on the original WebSocket request ID.

恢复自动在 Space 层协调，连接时立即核对。现有 Agent 队列中的单个持久定时任务每分钟通过
局部索引检查未结束的本地执行，覆盖 Gateway / Agent 硬崩溃、缺少断线通知的情况。Session 锁
隔离正常执行，拿不到锁时下轮继续检查；已结束执行不进入索引和检查范围。内部 `turn.recover`
仅补交已保存结果，不启动 Harness 或重跑工具，也不依赖原 WebSocket 请求 ID。

```bash
cohub runtime status --space <space-id>
```

There is no public recovery command, API or button. Space headers show Runtime
status; only genuinely unavailable results expose an explicit stop confirmation,
requiring `sandbox.manage`. Confirming stopped executions is bound to a snapshot of the
uncertain set; new executions are never included. Original turn input, committed
messages, native files and result receipts are retained. A durable resolution note
records that prior effects remain unknown; late results cannot replace this terminal
state. Local projections are retired before rebuilding from server context. If an ACK
was lost before switching Harnesses, the Runtime asks only about its current pending
projection and rebuilds from the latest durable context when switching back.

An orphaned local projection never blocks a Harness permanently: once the server
reports that turn as terminal, the projection is archived under `retired/` and rebuilt,
whether or not a local result receipt survived. Only turns the server still considers
active require explicit local confirmation. Native files are never deleted.

不提供公共恢复命令、API 或按钮。Space 页头只展示状态，仅在结果确实不可用时提供异常停止确认，
需要 `sandbox.manage` 权限。停止确认绑定待核对
执行的快照，不包含后续新执行。原始输入、已提交消息、原生文件和结果文件均保留，持久化说明
会记录此前执行影响未知；迟到结果不能覆盖已确认终态。本地投影保留后，再从服务端上下文重建。
若 ACK 丢失后切换 Harness，切回时仅核对本机当前 pending 投影，再从最新持久上下文重建。
孤儿投影不会永久卡死：服务端一旦报告该 Turn 已终止，无论本机是否留存结果回执，都会把旧投影
归档到 `retired/` 并重建；仅服务端仍视为进行中的 Turn 才需要显式确认。原生文件不会被删除。

Transport failures remain offline/retrying, not requests for manual intervention.
Only an explicit missing-result response from Runtime needs attention. Automatic
reconciliation continues even then. Never infer that a disconnected execution has stopped.

网络错误只显示离线并自动重试，不要求用户干预。仅 Runtime 明确返回结果不可用时需要确认，
后台核对仍会继续。不能根据断线推断执行已停止。

## Boundaries / 边界

- Adapters currently start an RPC process per turn. Native conversation history
  resumes, but in-process PTY handles, background terminals and interactive
  extension state are not guaranteed to survive between turns. This is not full
  interactive-native parity; persistent Harness processes require a separate lifecycle design.
  当前适配器按 turn 启停 RPC 进程。原生会话历史可以恢复，但 PTY、后台终端和交互式扩展的进程内状态
  不保证跨 turn 存活；完整原生交互体验还需要单独设计长驻 Harness 进程的生命周期。
- Use Pi versions exposing RPC session events and Codex versions supporting
  app-server thread resume/fork. Verified with Pi 0.85.1 and Codex 0.154.0.
  Codex rollout-path recovery is an upstream experimental API; incompatible versions fail explicitly.
  Pi 需要支持 RPC 会话事件，Codex 需要支持 app-server thread resume/fork；已验证 Pi 0.85.1 和 Codex 0.154.0。
  Codex 按 rollout 路径恢复仍是上游实验接口，不兼容版本会明确报错。
- Native approval escalation is never automatically granted. Requests requiring
  an interactive local approval are rejected by the unattended adapter. Pi
  read-only execution is rejected because it cannot enforce the requested limit.
  不自动批准原生提权请求；需要本地交互批准的请求会被拒绝。Pi 无法保证只读权限，因此拒绝
  以只读模式运行。
- Unknown execution outcomes remain active and block automatic takeover. Local
  unconfirmed state requires reconciliation; it is not silently discarded or replayed.
  执行结果不确定时保留运行状态并阻止自动接管；本地未确认记录需要核对，不会静默丢弃或重跑。
- Completed results are durably checkpointed locally before delivery. A lost
  acknowledgement can replay that result, never the model or its tools. Only the
  latest result per Session/Harness is retained, avoiding an unbounded local outbox.
  完成结果先在本机可靠保存再回传。确认丢失时只补发结果，不重跑模型或工具；每个 Session/Harness
  仅保留最近一次结果，避免本地待确认数据无限增长。
- End-of-turn archival captures a snapshot under the Session lock, then uploads
  through a bounded background queue (8 uploads, 16 MiB per raw archive). It never
  changes the actual execution result. Missing or oversized archives fall back to
  public message context on another host; original local files remain intact.
  Turn 结束时在 Session 锁内捕获快照，通过有上限的后台队列上传（8 个上传、单份原始归档 16 MiB）。
  归档失败不改变执行结果；缺失或超限时，其他运行端使用公共消息上下文，本地原始文件仍然保留。
- Final local messages, Turn state and durable delivery intent commit together.
  Realtime, postprocessing, queue wakeups and bound external channels retry from that
  intent. Channel targets use stable command IDs and per-target enqueue progress.
  本地最终消息、Turn 终态和持久投递意图原子提交。实时事件、后处理、队列唤醒和绑定外部渠道
  均从该记录重试；渠道目标使用稳定 command ID 和逐目标入队进度。

## Verification / 验证

```bash
pnpm --filter @cohub/protocol test
pnpm --filter @cohub/agent test
pnpm --filter @cohub/agent test:runtime
pnpm --filter @neta-art/cohub-cli test
pnpm --filter @neta-art/cohub-cli test:runtime
```

`test:runtime` uses loopback WebSockets and fixture RPC processes, never real
accounts or model requests. The optional `test:runtime:db` uses an isolated PostgreSQL
engine and requires `RUNTIME_TEST_DB_HOME`; it never connects to production. Apply `0065_runtime_harness_index` before deploying
services that read `harness_index`. Deploy Worker, API, Gateway and every Agent instance
before enabling the updated Web/CLI. Worker must understand local usage before local
results arrive, so they cannot be charged as cloud executions.

`test:runtime` 使用本机 WebSocket 和模拟 RPC 进程，不访问真实账号或模型。
可选的 `test:runtime:db` 使用隔离 PostgreSQL 引擎，需要设置 `RUNTIME_TEST_DB_HOME`，不会连接生产数据库。
部署前需执行 `0065_runtime_harness_index` 迁移；Worker、API、Gateway 和所有 Agent 实例更新后，
再启用新 Web / CLI。Worker 必须先识别本地用量，避免重复按云端执行计费。

For opt-in real-model testing, prepare an isolated directory containing `home/`,
`pi/` and `codex/`, with native authentication/configuration. This test makes model
requests and writes temporary files; it never connects to a Cohub server. Set
`COHUB_NATIVE_TEST_PI_BIN` / `COHUB_NATIVE_TEST_CODEX_BIN` to override executables.

真实模型测试需要显式启用：准备包含 `home/`、`pi/`、`codex/` 的隔离目录，并配置原生鉴权。
测试会请求模型并写入临时文件，不连接 Cohub 服务端；可通过
`COHUB_NATIVE_TEST_PI_BIN` / `COHUB_NATIVE_TEST_CODEX_BIN` 指定程序路径。

```bash
COHUB_NATIVE_TEST_HOME=/path/to/isolated-config \
COHUB_NATIVE_TEST_PROVIDER=your-provider \
COHUB_NATIVE_TEST_MODEL=your-model \
pnpm --filter @neta-art/cohub-cli test:runtime:native
```

The native matrix checks streaming, real file-writing tools, native resume,
archive import, Pi/Codex handoff and abort with partial-output retention. Provider
features and sandbox permissions come from the test configuration, not Cohub overrides.

真实矩阵覆盖流式输出、工具写文件、原生续接、归档导入、Pi/Codex 交接和中止后保留部分输出。
Provider 功能和沙箱权限由测试配置决定，Cohub 不代为放宽。
