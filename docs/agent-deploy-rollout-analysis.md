# Agent 服务重发版 / 部署形态风险梳理

本文档用于沉淀当前 `apps/agent` 服务在重新发版、滚动部署、实例替换时的风险分析，以及 Deployment / StatefulSet 的取舍与长期演进建议。

> 范围说明
>
> - 本文聚焦 `apps/agent` 控制面服务。
> - 目标是帮助后续做架构决策，不包含具体施工实现。
> - 结论基于当前仓库内 agent、deploy、workflow、ownership、Redis 消费逻辑的现状分析。

---

## 1. 当前结论摘要

### 1.1 当前每次重新发版是否有风险

有，而且主要不是“服务起不来”，而是：

- 发版窗口内任务可能被路由到旧实例队列；
- 处理中任务在实例退出时可能悬空；
- owner 租约切换依赖超时，不是主动迁移；
- 正在进行中的 session / streaming / sandbox RPC 会被中断。

整体判断：

- **大多数时候能成功重启并继续服务**；
- **但当前并不具备严格意义上的平滑发布 / 无损切换能力**；
- **活跃对话、长任务、发布时并发输入越多，风险越高**。

### 1.2 改成 StatefulSet 会不会更好

会 **有帮助**，但主要是缓解，不是根治。

主要收益：

- Pod 名更稳定；
- `AGENT_INSTANCE_ID` 更稳定；
- Redis 队列名更稳定；
- 能明显缓解“重发版后旧实例 input queue 无人消费”的问题。

主要局限：

- 不能解决 `processing_queue` 崩溃恢复；
- 不能解决优雅摘流 / owner 主动迁移；
- 不能解决 session / streaming 中断；
- 不能从根上解除“任务地址依赖实例身份”的架构耦合。

### 1.3 长期推荐方向

长期不建议把稳定性建立在 StatefulSet 上，而应把 agent 演进为：

- **实例可替换**；
- **任务可恢复**；
- **owner 可迁移**；
- **消息不依赖实例 ID 存放**；
- **Deployment 也能安全滚动发布**。

一句话概括：

> 实例可以死，任务不能丢；实例可以换，space 的处理权要能安全转移。

---

## 2. 当前架构与关键事实

## 2.1 Agent 的角色

当前 `apps/agent` 是控制面服务，承担：

- 运行 `pi-coding-agent`；
- 管理 session / persistence；
- 处理 Redis 输入输出；
- 基于 ownership 处理 space 对应任务；
- 与 sandbox 建立 WS 协作并执行 `workspace.prepare`；
- 上报 runtime / sandbox 状态。

## 2.2 当前部署与运行模型

当前观察到的几个关键点：

- agent 是独立 Deployment；
- `AGENT_INSTANCE_ID` 默认来自 `HOSTNAME`，通常等于 Pod 名；
- Redis 输入队列按 `instanceId` 维度命名；
- space owner 通过 Redis lease 维护；
- shutdown 时会做一定清理，但没有完整 draining / 迁移闭环。

## 2.3 当前与发布相关的关键实现特征

### 实例 ID

默认实例 ID：

- `AGENT_INSTANCE_ID = HOSTNAME || agent-${pid}`

这意味着在 Kubernetes 下，**实例身份天然与 Pod 名强绑定**。

### 输入队列命名

当前输入 / 处理中 / 死信队列命名类似：

- `agent:instance:{instanceId}:input_queue`
- `agent:instance:{instanceId}:processing_queue`
- `agent:instance:{instanceId}:dead_letter_queue`

这意味着：

- 消息地址依赖 `instanceId`；
- 一旦实例 ID 变化，消息消费位置也会变化。

### 输入消费模型

当前消费模型是：

1. 从 input queue 拉取；
2. 先搬到 processing queue；
3. 成功后 ack；
4. 失败则进入 dead letter。

该模型具备一定“处理中隔离”能力，但 **缺少崩溃后恢复处理逻辑**。

### owner 机制

当前 space owner 通过 Redis lease 管理：

- 有 `leaseUntil`；
- 有 `epoch`；
- agent 会续约；
- API 会依据 owner 决定消息应路由到哪里。

这说明系统已经有多实例 ownership 骨架，但 **还没有形成完整的迁移协议**。

---

## 3. 当前重发版的主要风险

下面按严重程度和影响面梳理。

## 3.1 风险一：旧实例队列在重发版后可能无人消费

### 现象

如果使用普通 Deployment，Pod 每次 rollout 后通常会换名，进而导致：

- 新实例拥有新的 `AGENT_INSTANCE_ID`；
- 新实例只监听新的 `agent:instance:{newId}:input_queue`；
- 旧实例遗留的 `input_queue` 不会被新实例继续消费。

### 问题本质

消息当前是“投递给实例”，而不是“投递给 space / 任务系统”。

### 为什么发版时特别容易触发

因为 owner lease 存在超时窗口：

- 旧实例退出后，旧 owner lease 不会立刻消失；
- API 在 lease 未过期前，仍可能把新消息路由给旧 owner；
- 这些消息就会继续落到旧实例的 input queue；
- 但旧实例已经退出，新实例又不监听旧队列。

### 结果

会出现：

- prompt 发出后没有响应；
- Redis 中旧 queue 残留任务；
- 表象上像“消息发出去了，但 agent 没处理”。

这是当前重发版最核心的问题之一。

---

## 3.2 风险二：processing_queue 没有恢复机制，任务可能半丢失

### 当前模型

任务被消费时，会先从 `input_queue` 挪到 `processing_queue`，处理完成后再 ack。

### 风险点

如果 agent 在以下时机退出：

- 消息已进入 `processing_queue`；
- 但还没 ack / reject；

那么这条任务会：

- 不再留在原始 input queue；
- 又没有恢复扫描或重试机制；
- 新实例也不会自动接手它。

### 结果

这类任务会变成：

- 不一定进入 dead letter；
- 不一定自动重试；
- 但也没有被真正完成。

可以理解为一种“处理中悬空”的半丢失状态。

这是当前发布安全性的第二个核心问题。

---

## 3.3 风险三：shutdown 没有完整的优雅摘流 / 迁移协议

### 当前已有能力

收到 `SIGTERM` / `SIGINT` 时，agent 会做一些清理，例如：

- 停止 session；
- 尝试等待持久化链路；
- 上报部分状态；
- 关闭 Redis 连接；
- 最终退出。

### 当前缺失能力

但还没看到完整的下线协议，例如：

- 显式上报 `draining` / `stopping`；
- 告诉上游“不要再派新任务给我”；
- 主动释放或迁移自己持有的 space owner；
- 转移未开始任务；
- 恢复处理中任务。

### 结果

这意味着当前更接近：

- **实例被动退出**，系统靠超时自行修复；

而不是：

- **实例主动摘流并有序交接**。

---

## 3.4 风险四：owner lease 切换依赖超时窗口，不是即时切换

当前 owner lease 约为 15 秒量级，并通过续约维持。

### 好处

- 避免 owner 抖动；
- 多实例时有基本稳定性；
- 能通过 epoch 做所有权校验。

### 风险

旧实例退出后：

- 新 owner 不会立刻接手；
- 上游在 lease 过期前仍可能视旧 owner 为有效；
- 如果队列又按实例分片，就会进一步放大发版窗口问题。

### 结论

lease 机制本身没有问题；
真正的问题是它与“实例队列绑定”叠加后，会让短暂切换窗口变成任务悬空窗口。

---

## 3.5 风险五：活跃 session / streaming / sandbox RPC 在发版时会被中断

### 典型场景

发版时如果某个 agent 正在：

- 生成流式回复；
- 执行工具调用；
- 与 sandbox 进行 WS RPC；
- 做 session 持久化；

则实例退出时可能会出现：

- 回复流中断；
- 前端收到 error；
- 一次任务只完成部分输出；
- 状态短时不一致。

### 判断

这类中断在有状态长连接服务里比较常见，未必完全不可接受；
但如果同时叠加消息恢复缺失，就会从“中断”变成“卡死或半丢失”。

---

## 3.6 风险六：K8s 部署层缺少发布保护细节

当前部署模板未体现以下典型保护项：

- `readinessProbe`
- `livenessProbe`
- `startupProbe`
- `preStop`
- `terminationGracePeriodSeconds`
- 明确的滚动升级策略
- `PodDisruptionBudget`

### 影响

这会导致：

- K8s 不知道 agent 何时真正 ready；
- 旧 Pod 下线前没有优雅缓冲；
- shutdown 清理所需时间无法得到保障；
- 对 Redis worker / 长连接 / session 服务来说，发布风险放大。

---

## 3.7 风险七：文档与连接方向描述存在认知偏差风险

从文档描述看，多处表述为：

- sandbox 主动连接 agent；
- agent 提供 WS server。

但从当前 agent 代码中的部分逻辑看，又存在 agent 主动连到 sandbox 地址的实现痕迹。

### 影响

这类认知偏差不一定直接导致发布失败，但会造成：

- 运维排障时容易判断错连接方向；
- Service、网络策略、探针和发布观察项配置容易偏差；
- 文档、现实实现和部署预期不一致。

---

## 4. 用 StatefulSet 的收益与缺点

## 4.1 为什么它会有帮助

StatefulSet 的直接收益在于：

- Pod 名稳定；
- `HOSTNAME` 更稳定；
- `AGENT_INSTANCE_ID` 更稳定；
- Redis 队列名也更稳定。

因此它能明显缓解：

- 旧实例 input queue 因 Pod 改名而失去消费者的问题；
- 实例身份漂移带来的排障复杂度。

对当前“实例 ID 直接参与消息路由”的实现来说，这是一个现实可见的好处。

## 4.2 它能改善哪些问题

### 1）改善旧 input queue 无人消费

同名 Pod 重启后，还是继续监听同一个 queue，旧任务不至于因为实例名变化直接悬空。

### 2）改善实例身份稳定性

owner、heartbeat、日志、分片观察都会更稳定。

### 3）为固定分片或稳定实例角色提供基础

如果未来短期内仍保留“实例承担固定职责”的思路，StatefulSet 会更顺手。

## 4.3 它解决不了哪些问题

StatefulSet **不能从根本上解决**：

- `processing_queue` 恢复；
- graceful draining；
- owner 主动迁移；
- session / streaming 中断；
- 任务与实例强耦合的结构性问题。

### 核心判断

StatefulSet 解决的是：

- **实例 ID 稳定性问题**；

而不是：

- **任务生命周期管理问题**。

## 4.4 它的主要缺点

### 1）会加重“实例有身份”的系统倾向

系统会更像在维护一组具名节点，而不是一组可替换 worker。

### 2）可能掩盖真正的架构问题

问题从“经常暴露”变成“偶尔爆炸”，但并没有真正消失。

### 3）扩缩容和长期无状态化方向会受约束

如果长期目标是让 agent 更接近无状态 worker，StatefulSet 不一定是终局形态。

### 4）滚动升级与实例治理通常更重

相比普通 Deployment，StatefulSet 更适合稳定身份，不一定更适合灵活弹性。

## 4.5 对 StatefulSet 的定位建议

建议将 StatefulSet 视为：

- **短中期缓解手段**；
- **不是长期架构依赖点**。

---

## 5. 长期应该如何改

长期目标不是“让某个 Pod 更稳定”，而是“让实例替换不影响任务完整性”。

## 5.1 长期目标

把 agent 演进成：

- Pod 可随时替换；
- 新旧实例可平滑交接；
- 任务中断后可恢复；
- space 处理权可迁移；
- 会话关键状态可重建；
- Deployment 也能安全滚动发布。

## 5.2 最核心的结构性改造方向

### 方向一：不要再按 instanceId 存放任务

当前最大根因是：

- 任务地址依赖实例 ID。

长期建议改为：

- 任务按 `space` 存放；
- 或按统一任务系统存放；
- owner 只是“当前谁来处理”，而不是“消息存在哪”。

### 更理想的语义

不是：

- 这条消息属于 `agent-abc`；

而是：

- 这条消息属于 `space-x`，当前由某 owner 处理。

## 5.3 推荐的任务组织方式

可以考虑两类大方向。

### 方案 A：按 space 组织输入队列

例如：

- `space:{spaceId}:input`
- `space:{spaceId}:processing`
- `space:{spaceId}:output`

特点：

- 队列和业务实体一致；
- owner 变更时，新 owner 继续消费同一个 space 队列；
- 语义清晰，天然适合 space 级串行控制。

代价：

- 活跃 space 多时，需要管理更多队列；
- 消费调度会更复杂。

### 方案 B：统一任务队列 + ownership 检查

例如：

- 所有任务先进入统一队列或 stream；
- worker 拉取后尝试 claim / 校验对应 space；
- claim 成功才处理。

特点：

- 基础设施更简单；
- 更接近通用 worker 系统；
- 横向扩展更自然。

代价：

- 需要更严谨的串行处理控制；
- 任务冲突和重试设计更重要。

### 当前项目更建议的方向

结合现状，更推荐的原则是：

> 至少让任务语义上归属于 `space` 或“任务系统”，而不要归属于实例队列。

---

## 5.4 引入真正的“任务可恢复”机制

当前 `list + brpoplpush + processing_queue` 模型，最缺的是恢复能力。

长期应该引入显式任务状态机，例如：

- `queued`
- `claimed`
- `processing`
- `done`
- `failed`
- `dead`

并记录：

- `claimedBy`
- `claimedAt`
- `ackDeadline`
- `retryCount`
- `lastError`

### 目标效果

如果 worker 挂了：

- 任务不会永久挂在处理中；
- 超时后可重新 claim；
- 能自动重试或转死信；
- 系统可观察、可审计、可恢复。

### 可选实现思路

#### 方案 1：Redis Stream + Consumer Group

优点：

- 原生 pending 语义；
- 支持 reclaim 未 ack 消息；
- 比 list 更适合 worker 场景。

缺点：

- 实现复杂度更高；
- 需要重新设计 space 串行处理策略。

#### 方案 2：Redis 自建任务状态机

用 Hash / ZSet / Set 等组合实现。

优点：

- 灵活；
- 便于表达业务状态。

缺点：

- 需要自己维护更多一致性细节。

#### 方案 3：任务状态入 DB，Redis 只做唤醒

优点：

- 审计更完整；
- 适合重要业务。

缺点：

- 成本更高；
- 复杂度更高。

### 原则建议

无论选哪种实现，长期都应达到：

> worker 崩了，任务还能恢复；而不是任务跟着 worker 一起消失。

---

## 5.5 把 ownership 从“被动超时”升级成“可主动迁移”

当前 ownership 已有 lease 与 epoch，这是一个很好的基础。

长期还需要补齐：

- `ready`
- `draining`
- `stopping`
- `stopped`

这样的实例状态语义。

### 理想的下线流程

1. agent 收到下线信号；
2. 标记自身为 `draining`；
3. 上游不再给它派新任务；
4. 处理完当前任务，或把可迁移任务交接出去；
5. 主动释放 / 转移 space owner；
6. flush 关键状态；
7. 退出。

### 为什么这很重要

这能把当前的：

- “Pod 没了，系统靠 lease 超时自愈”

升级成：

- “Pod 有序摘流，系统主动交接处理权”。

这会显著提升发布质量与稳定性。

---

## 5.6 把 session 设计成“可重建”，而不是强依赖实例内存对象

当前 session 有不少运行时状态在 agent 内存对象中管理，这是正常的。

但长期应该确保：

- 关键会话状态可从外部恢复；
- 已接收任务状态明确；
- 已输出内容可持久化；
- 未完成任务可重试或明确失败；
- agent 重启后能重建最小必要状态。

### 注意

长期目标不一定是“精确恢复到上一次生成到第几个 token”；
真正重要的是：

- 业务状态一致；
- 任务状态清楚；
- 用户体验可预期。

---

## 5.7 让 sandbox 生命周期与 agent 实例进一步解耦

长期建议将 sandbox 更多视为：

- 归属于 `space` 的运行时实体；
- owner agent 只是当前控制者；
- owner 切换时，新 agent 能复用、接手或安全重建 sandbox。

### 更理想的运行时注册信息

建议逐步具备更完整的 runtime registry，例如记录：

- `spaceId`
- `sandboxId`
- `status`
- `ownedBy`
- `lastHeartbeatAt`
- `preparedAt`
- `endpoint` 或连接信息

这样 owner 切换时，系统更容易做到接管而不是重建一切。

---

## 5.8 补齐 K8s 层的优雅发布能力

即使应用层改好了，发布层仍应补齐：

- `readinessProbe`
- `livenessProbe`
- `startupProbe`
- `preStop`
- `terminationGracePeriodSeconds`
- 合理的 RollingUpdate 策略
- `PodDisruptionBudget`
- 必要时的反亲和 / 拓扑分散

### 原因

agent 不是普通短连接 API，它同时具备：

- Redis worker 特征；
- 长连接 / WS 协作；
- session 生命周期管理；
- 持久化与所有权控制。

这类服务对“如何下线”和“何时 ready”都更敏感。

---

## 6. 建议的演进路线（按阶段）

为了降低改造风险，建议分阶段推进，而不是一次性重构。

## 6.1 阶段一：先补发布安全性

目标：

- 不大改架构，先降低发版事故概率。

建议方向：

- 增加实例 `draining / stopping` 语义；
- shutdown 时先摘流；
- API 识别 draining 实例，不再派新任务；
- 增加 `preStop` 和合理 `terminationGracePeriodSeconds`；
- 启动时至少检查异常残留任务；
- 增加更明确的发布观测项。

收益：

- 见效快；
- 对线上发布最有直接帮助。

## 6.2 阶段二：让任务不再归实例队列

目标：

- 解除“消息地址 = 实例 ID”的耦合。

建议方向：

- 任务队列改为按 space 或统一任务系统组织；
- owner 仅表示处理权，不表示存储位置；
- 新 owner 能继续处理旧任务。

收益：

- 这是结构性拐点；
- 做完后，Deployment / StatefulSet 的选择不再那么关键。

## 6.3 阶段三：引入正式任务恢复机制

目标：

- worker 挂了，任务可继续。

建议方向：

- ack timeout；
- retry / reclaim；
- dead letter 规范化；
- 更清晰的任务状态机和可观测性。

收益：

- 从“尽量不出事”升级成“出事了也能恢复”。

## 6.4 阶段四：完善 ownership 迁移与 session 恢复

目标：

- 支持更高质量的平滑切换。

建议方向：

- owner transfer / release；
- session 关键状态外置；
- sandbox 运行时注册更完整；
- 活跃 space 的接管能力增强。

收益：

- 系统韧性明显提升；
- 更接近成熟控制面服务。

---

## 7. 对 Deployment 与 StatefulSet 的最终建议

## 7.1 短期建议

如果近期目标是：

- 降低重发版时旧实例队列悬空风险；
- 暂时不大改任务模型；

那么 **StatefulSet 可以考虑作为短中期缓解方案**。

它能提供真实收益，尤其是对当前 `AGENT_INSTANCE_ID` 与 Pod 名绑定的实现来说。

## 7.2 长期建议

长期目标应是：

- 即使用普通 Deployment，agent 也能安全发布；
- 稳定性来源于任务系统与 ownership 设计，而不是 Pod 名不变。

### 换句话说

理想状态下：

- StatefulSet 不是必须条件；
- Deployment 也不该天然不安全。

如果系统必须依赖 StatefulSet 才能避免问题，通常说明：

- 实例身份绑定过重；
- 任务恢复机制不完善；
- 发布协议还没补齐。

---

## 8. 当前最值得关注的验证与观察项

在后续实际发布或压测时，建议重点观察以下指标与现象。

## 8.1 Redis 队列残留

重点看：

- 旧实例 `input_queue` 是否有积压；
- 旧实例 `processing_queue` 是否有悬挂任务；
- `dead_letter_queue` 是否在发版后明显增长。

## 8.2 活跃 space 的连续性

重点看：

- 发布前正在活跃对话的 space，发布后是否还能继续响应；
- 是否出现“发得出去但不回”的情况；
- 是否有 session streaming 中断后无法恢复的情况。

## 8.3 owner 切换窗口

重点看：

- 旧 owner lease 过期前，是否仍有任务被派给旧 owner；
- 新实例实际开始接管的时间；
- 切换期间是否出现任务黑洞窗口。

## 8.4 shutdown 与退出时长

重点看：

- SIGTERM 到进程退出花了多久；
- 当前 grace period 是否足够；
- persistence 是否有未完成残留。

## 8.5 sandbox / runtime 状态一致性

重点看：

- 发布后 sandbox 是否被重复准备、重复连接或短时失联；
- `space runtime` 状态是否与真实运行态一致。

---

## 9. 最终结论

当前 agent 服务已经具备：

- ownership 基础能力；
- session / runtime 基础能力；
- 多实例控制面的雏形。

但从“重新发版是否足够安全”的角度看，仍存在明显短板：

- 任务地址依赖实例 ID；
- processing 无恢复；
- owner 切换偏被动；
- 优雅发布协议不完整。

### 因此可以给出以下结论

#### 结论一

当前每次重发版 **有真实风险**，尤其体现在：

- 旧实例队列消息无人消费；
- 处理中任务悬空；
- 活跃 session 被中断。

#### 结论二

StatefulSet **可以缓解问题**，但它解决的是实例身份稳定，而不是任务生命周期正确性。

#### 结论三

长期正确方向是：

- 让任务不归实例；
- 让 worker 可替换；
- 让任务可恢复；
- 让 owner 可迁移；
- 让 Deployment 也能安全滚动发布。

---

## 10. 推荐的一句话路线

> 短期可用 StatefulSet 缓解实例 ID 漂移；中期把任务从实例队列迁走；长期补齐任务恢复、owner 迁移与优雅发布，最终让 agent 成为真正可平滑替换的控制面 worker。
