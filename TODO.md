# TODO

- [ ] runtime 中的 workspace 文件夹能运行中自动同步到原 gitea 仓库特定 runtime 分支作为备份
- [ ] runtime 中的文件树需要能更友好实时暴露出来，也许不一定要在 runtime 中开服务来暴露，单独开个专门做这件事情的服务通过挂载整个 runtime 的 nas 来暴露
- [ ] 整套能力封装成 SDK 提供出来
- [ ] Web 变成一个标准 channel
- [ ] Discord channel 体验优化
- [ ] 加入飞书 channel
- [ ] Web 版的 session 管理梳理
- [ ] runtime 安全问题，当前暴露了 redis url，可能要换一种通信方式
- [ ] runtime 的休眠和恢复
- [ ] 指令系统，简单的 /new 等指令
- [ ] 规划统一 Cohub CLI：先形成长期愿景与命令结构，再逐步收敛现有 scripts；见 `docs/cli-vision.md`
- [ ] review gateway 的重启对 redis 的影响，当前 gateway 的 redis 数据结构
- [ ] 静态页面托管
- [ ] workspace 取色器
