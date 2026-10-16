# 小米 NAS 插件下载

推荐版本：**0.2.3，手机横屏全屏适配版**。本分支仅存放安装压缩包与文档，应用主分支和 Docker 镜像未改动，不提交解压后的插件源码。

- [直接下载 0.2.3 ZIP 安装包](https://github.com/ailo-clark/biliLive-tools/raw/refs/heads/nas-plugin-downloads/bililivewatch-proxy-plugin-0.2.3.zip)
- [部署与回滚手册](bililivewatch-proxy-0.2.3-manual.md)
- [下载离线 HTML 手册](https://github.com/ailo-clark/biliLive-tools/raw/refs/heads/nas-plugin-downloads/bililivewatch-proxy-0.2.3-manual.html)
- [测试报告](bililivewatch-proxy-0.2.3-test-report.md)
- [SHA-256 校验文件](bililivewatch-proxy-0.2.3-SHA256SUMS.txt)

## 0.2.3 修复

原网页只启用了全屏，进入 NAS App 全屏后可能继续保持竖屏。新版手机点击原播放器全屏按钮后优先请求系统横屏；方向锁定受限时，自动旋转原播放器、弹幕及控制栏。原生全屏被拒绝或 API 缺失时使用页面全屏。

适配旋转后的进度点击/拖动，保留同一 video 元素和分段连播；退出或关闭插件时恢复布局、宿主样式及本次方向锁定。竖向视频保持竖向，电脑不启用手机适配。整个 NAS App、Android 状态栏是否旋转由 App 的原生策略决定。

## 已安装 0.2.2 的升级步骤

先下载并上传 0.2.3 到 NAS，保存原 UID 和自定义 upstream，然后使用原回滚脚本回滚旧插件，再解压、检查并部署新版，最后完全退出和重开 NAS App。详细命令见手册。

无需更换 Docker 镜像或 Compose。插件回滚保留录像、原数据库及观看进度。若需要回到先前可用的 0.2.2，回滚 0.2.3 后使用保留的 0.2.2 原包重新检查、部署即可。

最终 ZIP 解压后通过 51 项部署/恢复测试；真实 Chromium 的 Android UA 与触摸视口验证了横屏布局、进度拖动、原生 API 受限处理、退出恢复，以及页面全屏内真实媒体 EOF 后连播。方向策略使用故障注入，未使用真实 Android 设备或 NAS App；仍需设备验收。

本版保留不依赖 Nginx sub 模块和 NAS overlay 配置映射识别。

ZIP SHA-256：

```text
02c2f3fd0e66ae36d2298638e1eb3ca9601658e7ca4c996f8b763f3af4c96077
```

旧 0.2.0、0.2.1、0.2.2 文件保留作历史归档。
