# 小米 NAS 插件 0.2.0 下载

本分支仅存放安装压缩包与文档。项目主分支和插件源码没有因本次上传而变更。

- [直接下载 ZIP 安装包](https://github.com/ailo-clark/biliLive-tools/raw/refs/heads/nas-plugin-downloads/bililivewatch-proxy-plugin-0.2.0.zip)
- [部署与回滚手册](bililivewatch-proxy-0.2.0-manual.md)
- [下载离线 HTML 手册](https://github.com/ailo-clark/biliLive-tools/raw/refs/heads/nas-plugin-downloads/bililivewatch-proxy-0.2.0-manual.html)
- [测试报告](bililivewatch-proxy-0.2.0-test-report.md)
- [SHA-256 校验文件](bililivewatch-proxy-0.2.0-SHA256SUMS.txt)

这是 Docker 原网页代理版：插件将请求转发到 NAS 上现有的 `http://127.0.0.1:3000`，安装包内包含部署、回滚脚本及完整中文说明。

最终压缩包解压后通过 34 项部署与恢复测试，并完成真实 Nginx、CLI 后端和浏览器播放验证。尚未连接真实小米 NAS，官方 App 与手机移动网络访问仍需在设备上验收，详情见测试报告。

ZIP SHA-256：

```text
ef99a1004a526578457aff682f5f752946a4d2dd4a92122fc9046fe3a5fea059
```
