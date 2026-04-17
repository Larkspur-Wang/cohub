# Cohub 核心概念与 Git / Gitea 映射关系

## 背景

为了让 Cohub 的产品概念保持简洁、直觉，同时又能复用 Git / Gitea 成熟的底层能力，需要明确区分两层模型：

- **Cohub 领域模型**：面向用户的 `Space` / `Checkpoint` / `Proposal`
- **Git / Gitea 实现模型**：底层的 `Repository` / `Commit` / `Pull Request`

这份文档用于单独说明：**Cohub 概念与 Git 概念之间的推荐映射关系**。

---

## 一、总体结论

推荐采用以下映射：

| Cohub 概念 | Git / Gitea 对应物 | 说明 |
|---|---|---|
| `Space` | 一个独立 Git repo + 当前运行中的 sandbox | Space 是用户感知的动态工作容器，repo 是其底层文件载体 |
| `Space ID` | backing repo 的稳定身份来源 | 推荐用 `space.id` 派生 repo 名 |
| `Space name` | 不直接映射为 repo 名 | 它是用户可见名称，而不是基础设施标识 |
| `Checkpoint` | repo 中某个不可变 commit | 最好再加一个稳定 tag/ref |
| `Fork Space` | fork repo，并将工作分支定位到某个 checkpoint commit | 概念上基于 checkpoint 派生，底层实现是 repo 级 fork + checkout/reset |
| `Proposal` | Cohub 领域对象，底层绑定一个 Gitea PR | Proposal 不应被简单等同于 PR |
| `Accept Proposal` | merge PR，并在目标 Space 中创建新的 Checkpoint | 合并结果固化为新的静态截面 |

一句话概括：

> `Space` 是动态容器，`Checkpoint` 是静态快照，`Proposal` 是共创请求；Git / Gitea 则是承载这些概念的底层文件与合并基础设施。

---

## 二、Space 与 Git Repo 的关系

## 2.1 推荐关系：一个 Space 对应一个独立 Git repo

推荐将 `Space` 定义为：

> 一个用户与 Agent 协作的动态工作容器，它在底层拥有一个独立 Git repo 作为文件状态的持久化载体。

即：

```txt
Space 1 : 1 Git Repo
```

这样做的好处：

1. **隔离性强**
   - 每个 Space 都是独立游乐场；
   - 符合 Cohub 文档中的动态探索心智。

2. **权限模型简单**
   - 每个 Space 可天然绑定 owner / collaborator；
   - 不需要多个用户共写一个 repo 的复杂 branch 权限模型。

3. **Checkpoint / Proposal 容易落地**
   - Checkpoint 对应 repo commit；
   - Proposal 可映射为跨 repo PR。

4. **符合“隐藏 Git 复杂度”的目标**
   - 用户不需要理解 repo 与 branch，只需要理解 Space 与 Checkpoint。

---

## 2.2 Space 的业务身份与 repo 名称应解耦

推荐区分：

- `space.id`：系统内的核心身份
- `space.name`：用户可见名称
- `space.storageRepoName`：底层 Git / Gitea repo 名

不建议直接使用：

```txt
repo_name = normalize(space.name)
```

推荐使用：

```txt
repo_name = space-{space_id}
```

例如：

```txt
space.id = 503936f4-636e-474a-8a28-5438447b851a
repo_name = space-503936f4-636e-474a-8a28-5438447b851a
```

原因：

- `space.name` 可修改；
- `space.name` 可能冲突；
- repo 名一旦创建通常不希望频繁变更；
- 基础设施标识不应由展示字段承担。

---

## 2.3 创建 Space 时应该发生什么

当用户从零创建一个 Space 时，推荐流程：

1. 生成 `space.id`
2. 根据 `space.id` 生成 `storage_repo_name`
3. 在 Gitea 中创建 repo
4. 写入 `v2.spaces`
5. 启动对应 sandbox / session

即：

```txt
Create Space
  -> create DB row
  -> create backing repo in Gitea
  -> provision sandbox
```

---

## 三、Checkpoint 与 Git Commit 的关系

## 3.1 推荐关系：一个 Checkpoint 对应一个 repo commit

推荐定义：

> Checkpoint 是某个 Space 在某一时刻被固化下来的静态快照；底层实现上，它对应 Space backing repo 中的一个 commit。

即：

```txt
Checkpoint 1 : 1 Git Commit
```

这个映射天然符合 Cohub 对 Checkpoint 的定义：

- 静态
- 不可变
- 可回溯
- 可作为后续 fork / proposal 的基准

---

## 3.2 创建 Checkpoint 时应该发生什么

当用户在某个 Space 中点击 “Save Checkpoint” 时，推荐流程：

1. 检查当前 working tree 是否有变化；
2. 如果有变化：
   - `git add`
   - `git commit`
   - `git push`
3. 将 commit hash 写入 `v2.checkpoints`
4. 可选：创建稳定 tag/ref 以保证 checkpoint 可追踪

即：

```txt
Save Checkpoint
  -> commit current space state
  -> push to backing repo
  -> insert checkpoint record
```

---

## 3.3 推荐为 Checkpoint 增加稳定 ref/tag

虽然最小实现中：

```txt
Checkpoint = commit_hash
```

已经足够，但更稳妥的做法是同时创建一个稳定引用，例如：

```txt
refs/tags/checkpoint-<checkpoint_id>
```

或：

```txt
refs/cohub/checkpoints/<checkpoint_id>
```

这样做的好处：

- Checkpoint 更易被稳定引用；
- 后续 fork / proposal 能直接基于 checkpoint ref 操作；
- 降低因 ref 丢失、历史移动而难以追踪的风险。

---

## 四、Fork Space 与 Git Fork 的关系

## 4.1 Cohub 语义：基于某个 Checkpoint 派生一个新 Space

从 Cohub 角度看，用户执行的是：

> 基于某个 Checkpoint 创建一个属于自己的新 Space。

这个表达是正确且推荐保留的。

---

## 4.2 Git / Gitea 的现实：fork 通常是 repo 级，不是 commit 级

需要明确的是：

- Gitea 通常支持的是 **fork 整个 repo**；
- 它并不是天然提供“基于某个 commit 直接 fork 出一个新 repo”的概念；
- 因此 Cohub 的“基于 Checkpoint fork Space”需要翻译为一组底层操作。

也就是说：

```txt
Cohub: fork from checkpoint
!=
Gitea native: fork from single commit
```

---

## 4.3 推荐实现方式

推荐实现为：

1. 对 source Space 的 repo 执行 Gitea fork；
2. 在新 repo 中创建或重置工作分支，使其指向目标 checkpoint 对应的 commit；
3. 为新 repo 创建新的 Space；
4. 将 `base_checkpoint_id` 设为 fork 的来源 checkpoint。

即：

```txt
Fork Checkpoint
  -> fork source repo
  -> checkout / reset target branch to checkpoint commit
  -> create new Space bound to new repo
```

这是当前最推荐的折中实现。

### 为什么推荐这种做法

- 能保留 Gitea repo 之间的 fork 关系；
- 后续创建 PR 更顺畅；
- 既符合 Cohub 的概念表达，也兼容 Gitea 的实际能力。

---

## 4.4 不推荐的替代方案

### 方案：多个 Space 共用一个 repo，仅靠 branch 区分

即：

```txt
Space A -> repo main
Space B -> repo branch-x
Space C -> repo branch-y
```

不推荐原因：

- Space 之间隔离性差；
- 权限模型复杂；
- 用户与 Agent 的动态工作区耦合在同一个 repo 中；
- 与“每个 Space 都是独立游乐场”的心智不一致。

---

## 五、Proposal 与 Pull Request 的关系

## 5.1 推荐关系：Proposal 是 Cohub 领域对象，PR 是其底层实现载体

推荐定义：

> Proposal 是用户将某个 Checkpoint 的成果申请并入目标 Space 的共创请求；底层实现上，它通常绑定一个 Gitea Pull Request，但不应被简单等同于 PR。

也就是说：

```txt
Proposal ≈ Pull Request
但 Proposal > Pull Request
```

Proposal 可能还包含：

- source checkpoint
- target space
- 发起人说明
- Agent 生成的设计上下文或摘要
- 合并状态与验证信息
- 额外讨论内容

而 PR 主要承载的是代码 diff 与 merge 行为。

因此：

- `v2.proposals` 应是主领域实体；
- Gitea PR 是其底层代码合并承载体。

---

## 5.2 创建 Proposal 时应该发生什么

推荐流程：

1. 用户选择某个 `source_checkpoint_id`
2. 用户指定 `target_space_id`
3. 系统在 source Space repo 中创建一个 proposal branch（如需要）
4. 调用 Gitea 创建 PR
5. 在 `v2.proposals` 中记录 Proposal
6. 把 Gitea PR 信息回填到 `proposals.meta` 或 `external_pr_id`

即：

```txt
Create Proposal
  -> create Cohub proposal row
  -> create source branch/ref for proposal
  -> open Gitea PR
  -> bind PR metadata back to proposal
```

---

## 5.3 Accept Proposal 时应该发生什么

当目标 Space 的 owner 接受 Proposal 时，推荐流程：

1. 在 Gitea 中 merge PR；
2. 目标 repo 产生新的 merge commit；
3. 系统基于 merge 后结果创建一个新的 Checkpoint；
4. 更新 Proposal 状态为 `accepted`；
5. 更新目标 Space 当前状态。

即：

```txt
Accept Proposal
  -> merge PR
  -> create new checkpoint on target Space
  -> update proposal status
```

这保证了：

- Proposal 合并后的结果被静态固化；
- 每一次重要整合都能被回溯。

---

## 六、建议补充的状态字段

在当前设计中，`spaces.base_checkpoint_id` 已存在，但从概念上看，建议未来进一步区分：

- `base_checkpoint_id`：这个 Space 最初派生自哪个 Checkpoint
- `head_checkpoint_id`：这个 Space 最近一次保存到哪个 Checkpoint

原因：

- `base` 表示来源；
- `head` 表示当前最新固化状态；
- working tree 中还可能存在 `head` 之后的未保存变更。

推荐未来演进为：

| 字段 | 含义 |
|---|---|
| `base_checkpoint_id` | Space 的起源基线 |
| `head_checkpoint_id` | Space 当前最近的静态存档 |

这样在 fork、proposal、diff、merge 场景下会更清晰。

---

## 七、权限与基础设施建议

虽然 Cohub 概念最终会映射到 Gitea repo / PR，但建议保持如下原则：

> **Cohub 是用户交互与权限入口，Gitea 是底层存储与协作基础设施。**

这意味着：

- 用户不需要直接理解 Gitea 的 repo / branch / fork 细节；
- Cohub API 应负责：
  - 创建 repo
  - fork repo
  - 创建 proposal branch
  - 创建 PR
  - merge PR
- 用户接触的是：
  - 创建 Space
  - 保存 Checkpoint
  - Fork Space
  - 发起 Proposal

这样才能真正实现“隐藏 Git 复杂度”的产品体验。

---

## 八、推荐的整体工作流示例

## 8.1 Alice 创建 Space

```txt
Create Space A
  -> create repo space-A
  -> bind repo to Space A
```

## 8.2 Alice 保存 Checkpoint A

```txt
Space A current state
  -> git commit abc123
  -> create Checkpoint A(commit=abc123)
```

## 8.3 Bob 基于 Checkpoint A Fork 出 Space B

```txt
Fork Checkpoint A
  -> fork repo space-A -> repo space-B
  -> reset / checkout main of repo space-B to abc123
  -> create Space B(base_checkpoint_id = Checkpoint A)
```

## 8.4 Bob 修改后保存 Checkpoint B

```txt
Space B current state
  -> git commit def456
  -> create Checkpoint B(commit=def456)
```

## 8.5 Bob 发起 Proposal 到 Alice 的 Space A

```txt
Proposal P
  source_checkpoint = Checkpoint B
  target_space = Space A
  -> create branch proposal/P on repo space-B
  -> open PR from repo space-B to repo space-A
```

## 8.6 Alice 接受 Proposal

```txt
Merge PR
  -> target repo gets merge commit ghi789
  -> create Checkpoint C(commit=ghi789) on Space A
  -> mark Proposal accepted
```

---

## 九、最终建议

推荐正式采纳以下理解：

### 1. Space

- Space 是用户面向的动态工作容器；
- 每个 Space 底层拥有一个独立 Git repo；
- repo 名由 `space.id` 派生，而不是由 `space.name` 决定。

### 2. Checkpoint

- Checkpoint 是 Space 某个时刻的静态快照；
- 底层对应 repo 中的一个 commit；
- 最好再附带稳定 ref/tag。

### 3. Fork Space

- 用户心智上是“基于某个 Checkpoint 派生新的 Space”；
- 底层实现上是“fork repo，再把工作分支定位到目标 checkpoint commit”。

### 4. Proposal

- Proposal 是 Cohub 的领域对象；
- 底层通过 Gitea PR 承载代码合并；
- 不应把 Proposal 简化成纯 PR。

---

## 十、一句话原则

> 在 Cohub 中，Git / Gitea 是底层实现；用户感知的是 Space、Checkpoint、Proposal 三个概念，而不是 repo、commit、PR 本身。
