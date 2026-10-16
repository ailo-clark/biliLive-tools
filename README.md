# 小米 NAS 插件下载

推荐版本：**0.2.1，兼容不含 http_sub_module 的 NAS Nginx**。本分支仅存放安装压缩包与文档，应用主分支未改动，不提交解压后的插件源码。

- [直接下载 0.2.1 ZIP 安装包](https://github.com/ailo-clark/biliLive-tools/raw/refs/heads/nas-plugin-downloads/bililivewatch-proxy-plugin-0.2.1.zip)
- [部署与回滚手册](bililivewatch-proxy-0.2.1-manual.md)
- [下载离线 HTML 手册](https://github.com/ailo-clark/biliLive-tools/raw/refs/heads/nas-plugin-downloads/bililivewatch-proxy-0.2.1-manual.html)
- [测试报告](bililivewatch-proxy-0.2.1-test-report.md)
- [SHA-256 校验文件](bililivewatch-proxy-0.2.1-SHA256SUMS.txt)

## 0.2.1 修复

旧 0.2.0 依赖 Nginx 可选模块，部分 NAS 会报告“缺少 http_sub_module；未修改配置”。0.2.1 改由 NAS 已有 plugin.cgi 的 Python 入口实时适配 Docker HTML/JS，视频、API 和 CSS 等仍由 Nginx 直接转发。无需安装该模块、更换系统 Nginx、修改录播容器或新增常驻服务。

如果旧版仅在检查阶段报错且提示未修改配置，直接解压本版检查和部署，无需回滚。若旧版已成功安装，先运行原回滚脚本，再部署本版。完整步骤见手册。

最终压缩包解压后通过 41 项测试，并在未编译 sub 模块的真实 Nginx、CLI 后端和 Chromium 中通过登录、日历、播放、进度恢复、全屏连播和视频 Range 验证。尚未连接真实小米 NAS，官方 App 与手机移动网络访问仍需在设备上验收。

ZIP SHA-256：

```text
5a926fef2df975c620fd68efb6c039c23cad8f08f158fa6122a401861b5f737d
```

旧 0.2.0 文件保留作历史归档，请优先使用 0.2.1。
