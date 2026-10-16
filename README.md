# 小米 NAS 插件下载

推荐版本：**0.2.2，修复 NAS 配置路径映射导致的重复写入误报**。本分支仅存放安装压缩包与文档，应用主分支未改动，不提交解压后的插件源码。

- [直接下载 0.2.2 ZIP 安装包](https://github.com/ailo-clark/biliLive-tools/raw/refs/heads/nas-plugin-downloads/bililivewatch-proxy-plugin-0.2.2.zip)
- [部署与回滚手册](bililivewatch-proxy-0.2.2-manual.md)
- [下载离线 HTML 手册](https://github.com/ailo-clark/biliLive-tools/raw/refs/heads/nas-plugin-downloads/bililivewatch-proxy-0.2.2-manual.html)
- [测试报告](bililivewatch-proxy-0.2.2-test-report.md)
- [SHA-256 校验文件](bililivewatch-proxy-0.2.2-SHA256SUMS.txt)

## 0.2.2 修复

旧版可能报告“共享配置在部署过程中发生变化，已停止：/data/etc/upper/config/plugin”。NAS 的 `/etc/config/plugin` 与 `/data/etc/upper/config/plugin` 可能是同一份配置的两个入口：脚本写入前者后，后者随之变化，被旧脚本误判为外部修改。

新版通过真实路径和 Linux overlay 挂载信息识别这种映射，只通过合并视图写入一次，并在回滚及开机恢复时沿用这一处理。真正独立的文件仍各自管理，真实外部改动仍会阻止覆盖。插件登记的业务字段是 `ports.bililivewatch.u<UID>`，默认端口 3000，不涉及录像数据或观看进度。

先执行 `sh /data/bililive-nas-plugin/runtime/status.sh`。若状态为 `rolled_back`，表示失败后已自动回滚，直接解压本版检查和部署；其他状态先按手册回滚，不删除状态或备份来强行重装。

本版继续兼容不含 `http_sub_module` 的 Nginx，实时使用 Docker 原网页，不新增容器、常驻网页服务或数据库。

最终压缩包通过 51 项测试和真实 Nginx、CLI 后端、Chromium 的播放验证。配置联动用临时目录别名复现，overlay 规则使用合成 mountinfo 验证；未连接真实 NAS 检查挂载表，官方 App 与移动网络仍需设备验收。

ZIP SHA-256：

```text
dc03f5cb6a95f56cf403859bc49469daa4331b0613b4a13f99f2486e3cb9f4fc
```

旧 0.2.0、0.2.1 文件保留作历史归档，请优先使用 0.2.2。
