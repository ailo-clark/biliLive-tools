# 小米 NAS Docker 网页代理插件：部署与回滚

版本 0.2.2。日期：2026-10-16（香港时间）。

## 1. 本版如何工作

本版统一使用现有 Docker 网页，不再维护第二份观看前端。主页、主播卡片、日历、播放器、分集、弹幕和主题设置都来自你当前部署的容器。

| App 中的业务请求 | NAS 读取的 Docker 地址 |
| --- | --- |
| `/plugin/<UID>/bililivewatch/web/index.html` | `http://127.0.0.1:3000/index.html` |
| `/plugin/<UID>/bililivewatch/web/assets/xxx.js` | `http://127.0.0.1:3000/assets/xxx.js` |
| `/plugin/<UID>/bililivewatch/api/watch-history/streamers` | `http://127.0.0.1:3000/api/watch-history/streamers` |
| `/plugin/<UID>/bililivewatch/api/common/video/<视频ID>` | `http://127.0.0.1:3000/api/common/video/<视频ID>` |

`127.0.0.1` 是 NAS 自身，不是手机。手机始终请求 NAS 插件地址，由 NAS 连接本机映射出的 Docker 3000 端口。这里是反向代理，不是把手机跳转到局域网 IP。

HTML/JS 请求通过 NAS 已有的 `plugin.cgi` 鉴权后，由插件 Python 入口读取并适配；API、视频和 CSS 等仍由 Nginx 直接转发。无需 `http_sub_module`，不替换系统 Nginx，不新增常驻进程或监听端口。

业务网页运行在一个很小的插件入口壳的 iframe 内。包内的 `index.html`、`shell.js` 仅负责这个窗口；不包含观看首页和播放器副本。

原 Docker 网页的默认 API 地址是根路径 `/api`。如果仅剥掉入站请求的插件前缀，网页仍可能请求 NAS 根目录 `/api/...`，这些请求没有插件前缀，无法被对应插件代理识别。因此插件的 Python CGI 会在返回的 JS 中把完整字符串 `"/api"` 替换成 `"/plugin/<UID>/bililivewatch/api"`。其他业务代码继续使用容器的原文件。

插件 CGI 在返回的原 HTML 中注入 `bridge.js`，只隔离本插件的浏览器存储，避免原网页常用的 `api`、`key`、`theme` 等字段覆盖 NAS 宿主页面。首次登录仍是 Docker 原有的登录页，使用原 `BILILIVE_TOOLS_PASSKEY`。

默认进入现有观看页 `#/mobile`。原网页的电脑版、侧边栏、设置等功能保持原有行为；本版不另做仅观看权限，登录后具有原网页对应的权限。

## 2. 部署条件

- 已有正常运行的 fullstack 容器，NAS 本机可访问它映射出的 3000 端口。你原来的 `3000:3000` 映射可以继续使用。
- 容器已有非空 `BILILIVE_TOOLS_PASSKEY`。脚本不读取或改变 Docker 环境变量。
- NAS 已开启 root SSH，具备 `/usr/bin/python3`（3.10+）、Nginx 和 systemd。
- 知道 NAS App 当前用户的数字 UID，不带 `u` 前缀。
- NAS 具备原生 `plugin.cgi` 插件入口及此方案使用的 `need_reject` 认证变量、`plugincenter.conf` 和 `/etc/config/plugin`。Nginx 无需编译 `http_sub_module`。

可以在 NAS SSH 中查看：

```sh
ls -1 /data/plugin/u*.list
nginx -t
```

例如 `u123456789.list` 对应 UID `123456789`。多用户 NAS 需要选 App 当前登录的用户。`nginx -t` 应确认当前配置有效。

如果固件布局不同或缺少必要环境，检查脚本会停止，不会替换 NAS 的 Nginx、开启 SSH 或改变系统密码。

本地验证基线是 `ghcr.io/ailo-clark/bililive-tools:watch-calendar-20261015` 对应的原 Docker 网页。无需更换该镜像。后续 Docker 更新网页后，刷新或重新打开插件即可；如果将来改变 API 基地址、资源目录或嵌入策略，需要重新确认代理适配。

## 3. 从旧版重新部署

如果此前运行 0.2.0 时只提示“缺少 http_sub_module；未修改配置”，说明尚未安装成功，直接使用本版检查与部署，无需回滚，也不要修改系统 Nginx。

如果 0.2.1 曾提示“共享配置在部署过程中发生变化”，先执行 `sh /data/bililive-nas-plugin/runtime/status.sh`。`status` 为 `rolled_back` 表示已自动恢复，直接使用本版检查和部署；不是该状态时，先完成下方回滚。不要删除状态记录或备份后强行覆盖。

如果已经成功安装了旧版，在 NAS 的 root SSH 中先执行：

```sh
sh /data/bililive-nas-plugin/runtime/rollback.sh
```

然后完全退出并重新打开 NAS App。旧版回滚会保留原录像、观看进度、Docker 和 Compose。没有成功安装过旧版的用户直接进行下一步。

新旧版使用相同插件 ID，不能同时安装。检查脚本发现旧部署仍存在时会拒绝覆盖，避免丢掉最初备份。

## 4. 上传、解压和检查

下载 `bililivewatch-proxy-plugin-0.2.2.zip` 和对应 SHA256 校验文件。Linux/macOS 可用 `sha256sum`；Windows PowerShell 可以运行：

```powershell
Get-FileHash .\bililivewatch-proxy-plugin-0.2.2.zip -Algorithm SHA256
```

上传至 NAS（替换地址）：

```sh
scp bililivewatch-proxy-plugin-0.2.2.zip root@你的NAS地址:/tmp/
ssh root@你的NAS地址
```

NAS 没有 SFTP 子系统时，可在电脑用 `scp -O` 重试。

NAS root 终端中执行：

```sh
python3 -m zipfile -e /tmp/bililivewatch-proxy-plugin-0.2.2.zip /tmp/
cd /tmp/bililivewatch-proxy-plugin-0.2.2
sh deploy/check.sh --uid 123456789
```

把 `123456789` 换成你的数字 UID。检查包含包校验、路径冲突、用户、现有 Nginx 配置、原 Docker HTML 和登录接口。检查不修改 NAS 插件配置，只使用临时部署锁。

如果容器映射到其他端口：

```sh
sh deploy/check.sh --uid 123456789 --upstream http://127.0.0.1:实际端口
```

填写 fullstack 的主机映射端口，不是容器内部的 18010。只接受 `http://127.0.0.1:数字端口`。

## 5. 部署和登录

检查通过后：

```sh
sh deploy/deploy.sh --uid 123456789
```

自定义端口时，在部署命令中同样提供 `--upstream`。脚本会先备份配置，再注册插件、写入代理并执行 `nginx -t`；校验成功后重载。后续安装步骤出错也会尝试自动撤回。

记录成功输出中的备份目录，例如：

```text
/data/bililive-nas-plugin/backups/本次备份ID/
```

完全退出 NAS App/米家 App 后重新进入，打开「录播观看」。会看到 Docker 自带的登录页，输入原容器密钥即可。原网页若显示更新日志，按原有提示关闭。

本包不是小米签名的 `.mpk`，不要改扩展名后通过官方应用市场安装。

## 6. 配置变更和恢复边界

脚本不执行 Docker 命令，不修改 Compose、镜像、端口映射、录像目录或数据库结构。不新增 Python HTTP 常驻服务。

只修改以下共享配置中的本插件内容：

| 文件 | 变更 |
| --- | --- |
| `/data/plugin/u<UID>.list` | 增加 `bililivewatch` 条目 |
| `/etc/config/plugin` | 增加插件端口登记 |
| `/data/etc/upper/config/plugin` | 仅当它是独立文件时同步登记；与 `/etc/config/plugin` 共用底层配置时不重复写入 |
| `/etc/nginx/conf.d/luci/plugincenter.conf` | 增加带 BEGIN/END 标记的代理块 |

新建：

- `/home/u<UID>/plugin/bililivewatch/`：入口壳、适配脚本、图标及插件元信息，另含 UI 目录之外的 `src/proxy.json`（仅保存 UID 和本机端口）。
- `/data/plugin/www/u<UID>/bililivewatch`：UI 软链接。
- `/data/plugin/www/icon/bililivewatch.icon`：图标。
- `/etc/systemd/system/bililivewatch-restore.service`：重启恢复服务。
- `/data/bililive-nas-plugin/`：部署记录、独立回滚代码、原配置备份和入口壳恢复副本。

恢复副本不包含 Docker 网页，Docker 网页始终从 3000 端口实时取得。

部署前会只读识别目录别名和 Linux overlay 映射。两个路径对应同一配置时只写 `/etc/config/plugin`，避免脚本自己的写入被误判为外部修改；检查输出及新版状态记录会显示检测到的映射。内容相同但实际独立的文件不会被合并。

原始配置备份包含字节、权限和属主。无其他改动时回滚会恢复原始字节；若后来增加其他插件或设置，只移除本插件条目，保留其他变化。若本插件自己的配置被手工改动，回滚会先报告冲突，避免覆盖修改。

Nginx 不接管 NAS 根路径 `/api`，其他 NAS 服务的接口不受本插件路由影响。视频保持流式传输及 Range/206；API、SSE 和 WebSocket 经过同一个现有 Docker 服务。

## 7. 出问题时回滚

NAS 的 root SSH 中运行：

```sh
sh /data/bililive-nas-plugin/runtime/rollback.sh
```

此命令不依赖 `/tmp` 安装包仍然存在。也可使用下载包里的 `deploy/rollback.sh`。

回滚后完全退出 App 重进，检查：

```sh
sh /data/bililive-nas-plugin/runtime/status.sh
nginx -t
```

状态应为 `rolled_back`。重复回滚安全，恢复服务不会在下次开机重新创建插件。原 Docker 继续按原样使用；观看期间保存的进度不会被撤销。

如果安装被断电或强制终止，恢复 SSH 后先运行回滚，不能直接覆盖重装。遇到 `installing`、`rolling_back` 或 `recovery_needed`，同样先回滚。

如果报告配置冲突，备份仍在。不要直接拿整份旧 `.list` 覆盖当前文件，以免丢掉后来添加的其他插件。检查本插件注册项或 BEGIN/END 之间的代理块，修正冲突后重试。

```sh
ls -la /data/bililive-nas-plugin/backups/
```

每次备份中保留 `etc/...`、`data/...` 原始配置及同步更新的 `deployment.json`。这些文件可能含 NAS 私有配置，不要公开上传。

如果只是主部署记录 `state.json` 损坏，可确认**当前这次安装**的备份 ID、UID 和记录状态后，先保留损坏文件，再恢复记录并回滚：

```sh
cp -p /data/bililive-nas-plugin/state.json /data/bililive-nas-plugin/state.json.damaged
cp /data/bililive-nas-plugin/backups/本次备份ID/deployment.json /data/bililive-nas-plugin/state.json
chmod 600 /data/bililive-nas-plugin/state.json
sh /data/bililive-nas-plugin/runtime/rollback.sh
```

不要使用另一轮安装或之前已经回滚的备份记录。恢复能力依赖 NAS 存储、SSH、Python 和系统服务仍能工作。

回滚有意保留备份、状态及恢复资料，也不会远程清除 App 的浏览器缓存。需要清除登录时使用原 Docker 网页的「登出」功能。

## 8. NAS 重启与 Docker 更新

NAS 重建插件目录或列表时，恢复服务会尝试从 `/data` 恢复入口壳、图标、注册项和代理块，不启动、停止或重建录播容器。

```sh
systemctl status bililivewatch-restore.service
journalctl -u bililivewatch-restore.service -n 50 --no-pager
python3 /data/bililive-nas-plugin/runtime/manage.py restore
```

`restore` 只对 `installed` 状态生效。固件升级可能改变插件机制或删除服务单元，升级后需重新验收，不能承诺所有固件都自动恢复。

更新 Docker 网页后关闭并重开插件即可，不需要重新构建前端或安装新插件。将来若镜像改变 `/api` 基地址或网页结构，应重新检查适配。

重装插件时仍采用“先回滚，再检查和部署”，每轮保留独立备份。不要用 App 官方卸载按钮代替 SSH 回滚。

## 9. 真机与外网验证

先在家中 Wi-Fi 下检查原登录页、主播卡片、日历、视频拖动、全屏连播、进度保存和原网页设置。

再关闭手机 Wi-Fi，使用移动网络验证。优先使用 H.264/AAC 的 MP4。页面、接口、视频虽都经过 NAS 插件路径，官方 App 的 iframe、远程通道和长连接行为仍需真机确认。不要把本地浏览器测试通过当成外网播放已通过。

本方案不生成公开网址，也不要求修改路由器或把 3000 端口暴露到公网。视频码率、家庭上传带宽和 App 远程连接速度共同影响播放流畅程度。FLV/HEVC 是否能播取决于手机 WebView，插件没有新增转码服务。

| 问题 | 检查 |
| --- | --- |
| 旧版提示缺少 `http_sub_module` | 改用 0.2.2，旧检查未修改配置时无需回滚；不需要安装模块或替换系统 Nginx |
| 旧版提示共享配置发生变化，路径为 `/data/etc/upper/config/plugin` | 可能是 overlay 双路径联动导致的误报，0.2.2 已适配。先查状态；`rolled_back` 时直接换新版检查和部署，否则先回滚。真实外部改动仍需检查，不应跳过冲突保护 |
| 已有部署记录/目标占用 | 先确认旧版状态并回滚，不要删备份后直接覆盖 |
| 图标不出现 | 核对 UID，完全退出 App 后重进 |
| 页面白屏 | 检查 CGI、iframe 和 Nginx 代理；可能是 App/固件兼容问题 |
| 能看页面但接口失败 | 检查 CGI 的 JS 路径适配、NAS 登录态及 fullstack 端口 |
| HTML/JS 返回 502 | 检查本机 Docker 端口与 `src/proxy.json`，确认网页仍为原 fullstack 格式；不手工绕过错误检查 |
| 密钥错误 | 用 `BILILIVE_TOOLS_PASSKEY`，不要用小米密码或 BILIKEY |
| 局域网正常，外网不能播 | 需排查 App 远程视频通道，不能靠简单跳转局域网地址解决 |
