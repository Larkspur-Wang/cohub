## SessionComposer 高度计算

### 无附件时
外层 padding: pt-2 (8px) + pb-[calc(0.75rem + env())] (12px + env)
form padding: p-2 (8px)
textarea row: ~44px min + 底部工具栏 ~28px + 间距 ~6px + padding ~6px
总计: 约 8 + 8 + 44 + 28 + 6 + 6 = **100px + env**

### 有附件时（假设一行 2 张图）
在 textarea 之上增加:
- 附件区域: h-20 (80px) + mb-2 (8px) + pb-1 (4px) + 间距 = **96px**
其余不变
总计: 100 + 96 = **196px + env**

### 按钮位置
bottom: calc(env(safe-area-inset-bottom) + 5.75rem) = **env + 92px**

| 场景 | 输入框底部 | 按钮底部 | 结果 |
|------|-----------|---------|------|
| 无附件 | env + 100px | env + 92px | ✅ 按钮在输入框上方，有 8px 间隙 |
| 1行附件 | env + 196px | env + 92px | ❌ 按钮在输入框范围内，被遮挡 |
| 2行附件 | env + 292px | env + 92px | ❌ 同上 |

结论：**有附件时，按钮会被输入框的附件区域遮挡。**
