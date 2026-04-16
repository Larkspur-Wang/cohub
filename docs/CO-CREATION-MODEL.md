# cohub 核心领域模型与共创流设计

本系统采用了全新的动静分离架构，旨在将传统 Git/GitHub 复杂硬核的版本控制模型，转化为一套轻量、优雅且符合 AI/Agent 时代共创直觉的心智模型。

## 1. 核心概念 (Core Concepts)

系统的底层逻辑建立在“空间”与“时间”的物理隐喻之上，完美解耦了动态的探索与静态的固化。

### 1.1 Space (空间) —— 动态的探索场
- **定义**：用户与 Agent 共同进行创作、对话和文件变更的动态沙盒容器。
- **特征**：
  - **动态与活跃**：包含了未保存的草稿、实时的 Agent 对话历史 (Session) 以及各种进行中的实验。
  - **隔离性**：每个 Space 都是完全独立的游乐场，所有的修改（哪怕是破坏性的）都不会影响外部。
  - **直觉替代**：替代了传统概念中的 `Workspace` 或 `Repository (Working Tree)`，褪去了生硬的“工作搬砖”色彩。

### 1.2 Checkpoint (检查点) —— 静态的时间截面
- **定义**：当 Space 达到某个有价值的里程碑时，固化下来的不可变 (Immutable) 状态快照。
- **特征**：
  - **绝对静态**：一旦生成，不可被修改。它是后续回滚、派生和分享的绝对基准点。
  - **时间维度**：它记录了项目的演进历史，就像游戏中的存档点，给用户极大的安全感（随时可以读档重来）。
  - **直觉替代**：替代了传统概念中的 `Commit` 或 `Snapshot`，更具极客浪漫感与探索乐趣。

### 1.3 Proposal (提案) —— 共创的桥梁
- **定义**：社区成员将自己的创造成果（某个 Checkpoint）申请并入原项目 Space 的共创行为。
- **特征**：
  - **富文本交流**：它不仅包含代码差异，还可以包含 Agent 的上下文、设计思路等讨论，更具社区温度。
  - **直觉替代**：替代了传统的 `Pull Request / Merge Request`。

---

## 2. 共创工作流 (Co-Creation Workflow)

在 `cohub` 社区中，基于上述概念，完整的共创链路被简化为以下极简且流畅的步骤：

### 阶段一：起源与定格 (The Genesis)
1. 创造者 Alice 在她的 **Space** 中与 Agent 协作完成了一个优秀的项目。
2. Alice 为当前状态生成了 **Checkpoint A**，并将其在社区公开。
   *(此时，Checkpoint A 成为了社区中的一个可复用基准资产。)*

### 阶段二：派生与探索 (The Fork)
1. 贡献者 Bob 看到了公开的 Checkpoint A，希望为其增加一个新功能（如：暗色模式）。
2. Bob 点击 **Fork**。系统基于静态的 Checkpoint A，为 Bob 实例化出一个属于他自己的全新动态 **Space**。
   *(此时，Bob 拥有了完全隔离的游乐场，可放心大胆地让 Agent 修改。)*

### 阶段三：创造与存档 (The Creation)
1. Bob 在自己的 Space 中成功调通了暗色模式。
2. 为固化这一成果，Bob 将当前的 Space 状态保存为了一个新的静态截面 —— **Checkpoint B**。

### 阶段四：发起共创提案 (The Proposal)
1. Bob 希望将暗色模式回馈给 Alice 的原项目。
2. Bob 拿着自己的 **Checkpoint B**，向 Alice 的主 **Space** 发起了一个 **Proposal（提案）**。

### 阶段五：采纳与融合 (The Integration)
1. Alice 收到 Proposal 后，在自己的 Space 中预览并验证变更。
2. 确认满意后，Alice 点击 **Merge / Accept** 采纳提案。
3. 系统将 Bob 的变更合入主线，并自动生成一个全新的 **Checkpoint C**。至此，共创闭环完成！

---

## 3. 架构与数据设计偏好建议

为了契合系统“简单轻量、优雅、可扩展性好”的要求（如采用 TS + Drizzle），数据库层面的实现可遵循以下原则：

- **无外键约束**：依赖业务逻辑维系关联，提升扩展性和系统弹性。
- **Checkpoints 表为只读型设计**：存储快照哈希、溯源父节点 (`parent_checkpoint_id`)。
- **Spaces 表维护当前运行状态**：始终持有一个 `base_checkpoint_id` 以计算 diff。
- **Proposals 表作为状态机**：连接 `source_checkpoint_id` 与 `target_space_id`，流转状态 (open, accepted, rejected)。