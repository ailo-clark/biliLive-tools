小米 NAS 独立录播回放插件 v0.1.3，基于 biliLive-tools 4.2.0 构建。

- 录播播放器记住当前客户端的弹幕开关、字号、速度和透明度等设置，重新打开时自动恢复。
- 现有 Docker 服务可继续用于回放。升级沿用原来的 NAS 用户、端口和观看进度。

下载 **`bililivereplay-0.1.3.zip`** 和 **`SHA256SUMS.txt`**。安装包包含编译页面和部署手册。

解压后在 NAS 的 root 终端进入目录执行，可直接升级已安装的独立回放插件。

```sh
cd bililivereplay-0.1.3
sh install.sh
```

完成后完全退出小米客户端（Windows 上包括托盘），再打开「录播回放」。

运行以下命令可回退到上一版页面。

```sh
sh /data/bililive-nas-replay/runtime/rollback.sh
```

运行以下命令可完整卸载独立回放插件。

```sh
python3 /data/bililive-nas-replay/runtime/manage.py rollback
```

恢复机制要求 NAS 现有 Debian cron 正常运行并支持 `/etc/cron.d`。定时恢复可能有约两分钟延迟。

这是预发布版。自动化验证覆盖桌面盘符入口登录、手机全屏、播放进度同步、连播，以及安装、升级和回滚。
