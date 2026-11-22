小米 NAS 独立录播回放插件 v0.1.2，修复电脑客户端登录失败。

- 修复 Windows 电脑客户端 `/D:/plugin/...` 等带盘符或本地目录前缀的入口路径：登录、日历和播放请求统一使用本插件 API，不再误发到 NAS 自己的 `/api`。
- 同时支持数字及 `u` 前缀 UID，保持手机端入口兼容。
- 登录错误明确区分密钥错误、NAS 权限、观看接口缺失和 Docker 连接故障；拒绝误返回的 NAS 网页，并为登录请求设置超时。
- 保留每两分钟自动恢复、免 systemctl 的服务配置、先停止恢复再回滚及其他插件配置保护。

下载 **`bililivereplay-0.1.2.zip`** 和 **`SHA256SUMS.txt`**。ZIP 已含编译页面和完整部署手册；Source code ZIP 不能代替安装包。现有 Docker 镜像、录像和观看进度沿用原部署。

解压后在 NAS 的 root 终端进入目录执行，可以从 v0.1.0 / v0.1.1 直接升级：

```sh
cd bililivereplay-0.1.2
sh install.sh
```

完成后**完全退出小米电脑客户端（包括托盘），再重新打开插件**，输入与手机端相同的 Docker 登录密钥。

回退上一版页面：

```sh
sh /data/bililive-nas-replay/runtime/rollback.sh
```

完整卸载：

```sh
python3 /data/bililive-nas-replay/runtime/manage.py rollback
```

恢复机制要求 NAS 现有 Debian cron 正常运行并支持 `/etc/cron.d`。定时恢复可能有约两分钟延迟。

验证包含桌面盘符路径下的错误密钥提示、正确密钥重试、日历和场次操作，以及手机播放、全屏进度及连播。桌面路径通过浏览器代理模拟，尚未在真实小米 Windows 客户端或 Android App 上验收。本次为预发布版。
