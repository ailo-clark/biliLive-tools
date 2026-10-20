小米 NAS 独立录播回放插件 v0.1.1，补充新版固件清理后的自动恢复与安全回滚。

- 每两分钟检查一次，应用市场清理后从 `/data` 备份补回插件页面、入口及注册，保留其他插件配置与定时任务。
- 安装、开机恢复和回滚直接维护本插件服务链接，不调用 `systemctl`，避免 NAS 交互会话中的服务等待死锁。
- 回滚先停用定时任务和开机入口，再撤销插件配置；恢复任务与部署共用锁，防止卸载后被重建。
- `status.sh` 可查看最近检查时间和错误；支持从 v0.1.0 升级、回退旧版页面，并保留新版安全恢复脚本。
- 沿用已有 root 命令终端，不增加上传或连接工具。Docker 镜像、录像及观看数据库保持原有部署。

下载 **`bililivereplay-0.1.1.zip`** 和 **`SHA256SUMS.txt`**。ZIP 已含构建后的前端与部署手册；Source code ZIP 不能代替安装包。

解压后在 NAS 的 root 终端执行，新装和从 v0.1.0 升级相同：

```sh
cd bililivereplay-0.1.1
sh install.sh
```

多用户或自定义 Docker 端口：

```sh
sh install.sh --uid 12345 --upstream http://127.0.0.1:3000
```

查看恢复状态：

```sh
sh /data/bililive-nas-replay/runtime/status.sh
```

恢复到本次安装前的页面版本：

```sh
sh /data/bililive-nas-replay/runtime/rollback.sh
```

完整卸载（先停用自动恢复，再移除插件，保留 Docker 和观看数据）：

```sh
python3 /data/bililive-nas-replay/runtime/manage.py rollback
```

要求 NAS 现有 Debian cron 正常运行并支持 `/etc/cron.d`。定时恢复可能有约两分钟延迟；不修改云端 `server.list`。固件若同时清除了定时任务和开机入口，需要在 root 终端手动运行 `python3 /data/bililive-nas-replay/runtime/manage.py restore`。配置结构发生变化时脚本会停止并保留备份。

通过部署、升级、回滚及真实后端手机/电脑浏览器测试后发布；未在小米 NAS 新固件和真实 Android App 上验收。本次为预发布版。
