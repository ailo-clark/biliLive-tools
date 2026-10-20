# 小米 NAS 录播回放插件

独立的手机/电脑观看入口，共用 biliLive-tools 的主播卡片、录播日历、Artplayer、弹幕、分段连播和观看进度代码。只代理后端接口，不读取 Docker 的网页、不注入地址改写脚本。

## 安装

下载 GitHub Release 中的 `bililivereplay-0.1.1.zip`（不是 GitHub 自动生成的 Source code 压缩包），解压后在 NAS 的 root SSH 终端执行：

```sh
cd bililivereplay-0.1.1
sh install.sh
```

脚本优先沿用已安装插件的用户和端口；首次安装仅在能够唯一识别用户时自动选择。多个用户或使用其他端口时：

```sh
sh install.sh --uid 12345 --upstream http://127.0.0.1:3000
```

完成后重新打开 NAS App，在「录播回放」中输入 Docker 的 `BILILIVE_TOOLS_PASSKEY`。手机和电脑使用同一套响应式页面。

## 回滚

```sh
sh /data/bililive-nas-replay/runtime/rollback.sh
```

首次安装后回滚会先停止本插件的定时恢复和开机入口，再撤销注册、Nginx 配置及页面文件，恢复部署前状态。升级后回滚会恢复上一版插件；重复执行不会再卸载已恢复的旧版。完整卸载使用 `python3 /data/bililive-nas-replay/runtime/manage.py rollback`。

安装后每两分钟检查一次，应用市场清理插件后从 `/data` 备份恢复。使用独立 `/etc/cron.d/bililivereplay` 文件，不修改 root crontab 或其他插件的任务。部署、恢复、回滚均不调用 `systemctl`，避免固件的交互会话死锁。

更多前提、备份路径、升级、定时及重启恢复与故障处理见 [部署手册](部署手册.md)。

## 源码与构建

分支：`feat/xiaomi-nas-replay-plugin`。前端入口在 `packages/app/nas-replay`，插件部署源码在本目录。使用仓库锁定的 Node/pnpm，无需新增应用依赖：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter biliLive-tools build:nas-replay
python3 plugins/xiaomi-nas-replay/scripts/prepare.py
python3 -m unittest discover -s plugins/xiaomi-nas-replay/tests -p 'test_*.py' -v
python3 plugins/xiaomi-nas-replay/scripts/pack.py --output /tmp/nas-replay-release
```

浏览器集成测试需要先构建 shared/HTTP/CLI 并准备 ffmpeg、Nginx、Playwright Chromium，实际命令见专用的 `nas-replay-release.yml`。该工作流会测试、构建并发布可安装 ZIP；安装时 NAS 不需要 Node.js、pnpm 或编译工具。
