1. 数据是最重要的，注意数据安全不能有失
2. 交互和 UI 相关分析和改动注意学习设计 skill
3. 完成需求要同时考虑到服务端、sdk、cli、web 端（PC 和移动端）
4. 首屏体验极其重要，注意数据的本地缓存
5. 保持优雅简洁，保持整体一致性，宁愿累一点多做整理重构
6. 性能很重要，无论是 db、服务端、前端
7. IndexedDB 数据都来自服务端可靠数据
8. 常用数据加载策略是，交互上优先使用本地数据，同时静默拉取相关服务端数据更新缓存并且静默更新展示，少做干扰布局的 loading 态，尽量避免渲染变更和跳动
9. 注意多端同步体验，有优雅高效的实时事件设计
10. 文案都使用英文，保持简洁
11. 直接 push main，不用开新分支

## Release Workflow

```bash
# 1. 发布 npm 包
pnpm changeset version && pnpm release

# 2. 生成 changelog 并打项目 tag
pnpm changelog:release v1.99.0

# 3. 推送
git push && git push origin v1.99.0
```

详见 `scripts/changelog/README.md`。
