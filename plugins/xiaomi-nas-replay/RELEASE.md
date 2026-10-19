小米 NAS 独立录播回放插件首版，适配手机和电脑。

- 主播卡片 → 录播日历 → 当天场次 → 分段播放，保留继续观看、弹幕和自动连播。
- 当天场次右侧勾选按钮可将整场全部分段标记已看，保留已有位置并刷新日历。
- 复用现有播放器和进度同步，不代理 Docker 网页，不注入地址改写脚本。
- 一键安装和升级，配置备份、失败自动恢复、上一版回退及重启恢复；可与原代理插件共存。
- 沿用 Docker 独立观看数据库，不修改原数据库、挂载或录像文件。

下载 **`bililivereplay-0.1.0.zip`** 和 **`SHA256SUMS.txt`**。ZIP 已含构建后的前端；GitHub 自动生成的 Source code ZIP 用于源码查看，不能代替安装包。

在 NAS 的 root SSH 终端解压并进入目录：

```sh
cd bililivereplay-0.1.0
sh install.sh
```

多用户或自定义 Docker 端口：

```sh
sh install.sh --uid 12345 --upstream http://127.0.0.1:3000
```

回滚：

```sh
sh /data/bililive-nas-replay/runtime/rollback.sh
```

建议现有 Docker 使用 `ghcr.io/ailo-clark/bililive-tools:watch-progress-fullscreen-r1`。安装后在插件里输入 Docker 的 `BILILIVE_TOOLS_PASSKEY`。

包内附完整部署手册。已通过前端测试、部署/升级/回滚测试及真实后端的手机和电脑浏览器验证；尚未完成小米 NAS 与 Android App 实机验收。本次为预发布版。
