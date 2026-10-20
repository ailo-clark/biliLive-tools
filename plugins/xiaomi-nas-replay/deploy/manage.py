#!/usr/bin/env python3
"""Transactional Xiaomi NAS installer. Standard library only; never calls Docker."""
import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from nginx import PLUGIN, markers, render, remove_block, validate_upstream

UNIT = "bililivereplay-restore.service"
UNIT_PATH = f"/etc/systemd/system/{UNIT}"
UNIT_LINK = f"/etc/systemd/system/multi-user.target.wants/{UNIT}"
CRON = "/etc/cron.d/bililivereplay"
STATE = "/data/bililive-nas-replay"
SHARED = ["/etc/config/plugin", "/data/etc/upper/config/plugin"]


def recovery_cron():
    # Debian cron automatically notices this dedicated file; no daemon restart.
    return ("# Managed by bililivereplay; remove through rollback.sh.\n"
            "SHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n"
            f"*/2 * * * * root /usr/bin/python3 {STATE}/runtime/manage.py restore >/dev/null 2>&1\n")


def same_entry(actual, expected):
    """plugincenter can change runtime status without changing plugin ownership."""
    def stable(entry):
        copy = json.loads(json.dumps(entry))
        for key in ("status", "install", "upgrade", "enable", "changetime", "progress"):
            copy.pop(key, None)
        if isinstance(copy.get("info"), dict):
            copy["info"].pop("timestamp", None)
        return copy
    return isinstance(actual, dict) and stable(actual) == stable(expected)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def backing_path(path, mountinfo):
    """Resolve directory aliases and Linux overlay upper paths, without writing."""
    path = Path(path).resolve()
    seen = set()
    for _ in range(8):
        if path in seen:
            break
        seen.add(path)
        nearest = None
        for line in mountinfo.splitlines():
            try:
                before, after = line.split(" - ", 1)
                fields, filesystem = before.split(), after.split()
                if len(fields) < 5 or len(filesystem) < 3:
                    continue
                decode = lambda value: re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), value)
                mountpoint = Path(decode(fields[4]))
                relative = path.relative_to(mountpoint)
                if nearest is None or len(mountpoint.parts) > nearest[0]:
                    nearest = (len(mountpoint.parts), filesystem, relative, decode)
            except (ValueError, IndexError):
                continue
        if nearest is None or nearest[1][0] != "overlay":
            break
        upper = next((option.split("=", 1)[1] for option in nearest[1][2].split(",")
                      if option.startswith("upperdir=")), None)
        if upper is None:
            break
        upper = Path(nearest[3](upper))
        if not upper.is_absolute():
            break
        path = (upper / nearest[2]).resolve()
    return path


def verify_package(package):
    manifest = Path(package) / "MANIFEST.json"
    if not manifest.is_file():
        return  # Source checkout; downloadable releases always include a manifest.
    for name, expected in json.loads(manifest.read_text())["files"].items():
        path = Path(package) / name
        if path.is_symlink() or not path.is_file() or Path(package).resolve() not in path.resolve().parents:
            raise RuntimeError(f"插件包文件缺失或路径异常：{name}")
        if digest(path.read_bytes()) != expected:
            raise RuntimeError(f"插件包校验失败：{name}，请重新解压原始下载包")


def atomic(path, data, mode=None, owner=None):
    path = Path(path)
    old = path.stat() if path.exists() else None
    fd, name = tempfile.mkstemp(prefix=".bililivereplay-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, mode if mode is not None else stat.S_IMODE(old.st_mode) if old else 0o600)
        if owner is not None:
            os.chown(name, *owner)
        elif old and os.geteuid() == 0:
            os.chown(name, old.st_uid, old.st_gid)
        os.replace(name, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.lexists(name):
            os.unlink(name)


class System:
    def run(self, args, ok=(0,)):
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=45)
        if result.returncode not in ok:
            # Never print nginx -T, environment variables, or backend responses.
            raise RuntimeError(f"命令失败：{' '.join(args[:2])}（退出码 {result.returncode}）")
        return result

    def nginx_test(self):
        self.run(["nginx", "-t"])

    def nginx_reload(self):
        self.run(["nginx", "-s", "reload"])

    def preflight(self, upstream, no_probe=False):
        if not shutil.which("nginx"):
            raise RuntimeError("缺少命令：nginx")
        if not (shutil.which("cron") or Path("/usr/sbin/cron").is_file()):
            raise RuntimeError("未发现支持 /etc/cron.d 的 cron，停止安装；不会自动启动或替换调度服务")
        result = self.run(["nginx", "-T"])
        if not re.search(r"\$(?:need_reject)\b", result.stdout):
            raise RuntimeError("当前 Nginx 未发现 NAS 的 need_reject 认证变量，拒绝安装")
        if "plugincenter.conf" not in result.stdout:
            raise RuntimeError("Nginx 未加载 plugincenter.conf，拒绝安装")
        self.nginx_test()
        if not no_probe:
            request = urllib.request.Request(upstream + "/api/common/version")
            try:
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=8) as response:
                    body = response.read(4096)
                    if b'id="app"' in body or b"<html" in body.lower():
                        raise RuntimeError("upstream 返回前端页面，请确认是 fullstack 的端口")
                    if response.status == 200:
                        raise RuntimeError("后端接口没有要求登录密钥；请启用 BILILIVE_TOOLS_PASSKEY 后再部署")
            except urllib.error.HTTPError as error:
                if error.code != 401:
                    raise RuntimeError(f"现有服务版本接口返回 HTTP {error.code}，请检查端口") from None
            except urllib.error.URLError:
                raise RuntimeError("无法连接现有容器，请检查端口映射；脚本不会启动或修改容器") from None


class Manager:
    def __init__(self, root="/", system=None, mountinfo=None):
        self.root = Path(root).resolve()
        self.system = system or System()
        self.mountinfo = mountinfo
        self.base = self.path(STATE)
        self.manifest = self.base / "state.json"

    def path(self, path):
        return self.root / str(path).lstrip("/")

    def ensure_parent(self, path, state):
        missing = []
        parent = path.parent
        while not parent.exists():
            missing.append(parent)
            parent = parent.parent
        for parent in reversed(missing):
            parent.mkdir(mode=0o755)
            state["created_dirs"].append(str(parent.relative_to(self.root)))

    def save(self, state):
        data = (json.dumps(state, ensure_ascii=False, indent=2) + "\n").encode()
        atomic(self.manifest, data, 0o600)
        if state.get("backup"):
            atomic(self.path(state["backup"]) / "deployment.json", data, 0o600)

    def load(self):
        return json.loads(self.manifest.read_text())

    @contextmanager
    def lock(self):
        # Existing NAS directory; this lock is outside the managed state tree.
        lockfile = self.path("/tmp/bililivereplay-deploy.lock")
        if lockfile.is_symlink():
            raise RuntimeError("部署锁是符号链接，拒绝操作")
        fd = os.open(lockfile, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            os.close(fd)

    def snapshot(self, path):
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise RuntimeError(f"配置不是普通文件，拒绝修改：{path}")
        if not path.exists():
            return {"exists": False}
        data = path.read_bytes()
        info = path.stat()
        return {"exists": True, "data": base64.b64encode(data).decode(), "sha256": digest(data),
                "mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid}

    def original(self, snap):
        data = base64.b64decode(snap["data"])
        if digest(data) != snap["sha256"]:
            raise RuntimeError("备份校验失败，拒绝覆盖当前配置")
        return data

    def shared_layout(self, snapshots):
        mountinfo = self.mountinfo
        if mountinfo is None:
            try:
                mountinfo = Path("/proc/self/mountinfo").read_text()
            except OSError:
                mountinfo = ""
        targets, aliases, backing = [], {}, {}
        for logical in SHARED:
            location = backing_path(self.path(logical), mountinfo)
            alias = next((prior for prior in targets if backing[prior] == location), None)
            if alias is not None:
                before, other = snapshots[alias], snapshots[logical]
                if before["exists"] and other["exists"] and self.original(before) != self.original(other):
                    raise RuntimeError(f"配置映射读取不一致，已停止：{logical}；未覆盖当前配置")
                aliases[logical] = alias
            else:
                targets.append(logical)
                backing[logical] = location
        return targets, aliases

    def state_shared_targets(self, state):
        # Older packages did not record alias handling. Determine it read-only
        # before recovering such a journal; never write an overlay's raw upper.
        if "shared_targets" in state:
            return state["shared_targets"]
        return self.shared_layout(state["snapshots"])[0]

    def write_shared(self, logical, data, state):
        path = self.path(logical)
        snap = state["snapshots"][logical]
        self.ensure_parent(path, state)
        self.save(state)  # Journal directory creation before modifying config.
        atomic(path, data, None if snap["exists"] else 0o644)

    def inspect(self, uid, upstream, package, check_system=True):
        if not re.fullmatch(r"[1-9][0-9]{0,19}", str(uid)):
            raise ValueError("UID 必须是数字，不带 u 前缀")
        upstream, port = validate_upstream(upstream)
        package = Path(package).resolve()
        verify_package(package)
        if self.base.is_symlink():
            raise RuntimeError("状态目录是符号链接，拒绝操作")
        if self.base.exists() and not self.manifest.exists() and any(self.base.iterdir()):
            raise RuntimeError("状态目录存在但缺少部署记录，拒绝覆盖；请先检查原有文件")
        for name in ("INFO", "src/ui/config", "src/ui/index.html", "src/ui/icon.png", "deploy/manage.py", "deploy/nginx.py", "deploy/rollback.sh", "deploy/status.sh", "deploy/static_cgi.py", "scripts/control"):
            if not (package / name).is_file():
                raise RuntimeError(f"插件包不完整：缺少 {name}")
        # A local package should not link outside its distribution.
        for entry in (package / "src").rglob("*"):
            if entry.is_symlink():
                raise RuntimeError("插件包中不允许符号链接")
        if self.manifest.exists():
            current = self.load()
            if current["status"] not in ("rolled_back",):
                raise RuntimeError("已有部署记录。请先运行 status；需要重装时先 rollback")
        home = f"/home/u{uid}/plugin/{PLUGIN}"
        if not self.path("/etc/cron.d").is_dir():
            raise RuntimeError("未找到 /etc/cron.d，无法安装定时恢复任务")
        owned = [home, f"/data/plugin/www/u{uid}/{PLUGIN}", f"/data/plugin/www/icon/{PLUGIN}.icon", UNIT_PATH, UNIT_LINK, CRON]
        for logical in owned:
            if os.path.lexists(self.path(logical)):
                raise RuntimeError(f"目标已存在，拒绝覆盖：{logical}")
        for logical in (f"/etc/systemd/system/multi-user.target.wants/{UNIT}", f"/run/systemd/system/{UNIT}", f"/usr/lib/systemd/system/{UNIT}"):
            if os.path.lexists(self.path(logical)):
                raise RuntimeError(f"同名服务已存在，拒绝覆盖：{logical}")
        list_path = f"/data/plugin/u{uid}.list"
        nginx_path = "/etc/nginx/conf.d/luci/plugincenter.conf"
        snapshots = {p: self.snapshot(self.path(p)) for p in [list_path, nginx_path, *SHARED]}
        shared_targets, shared_aliases = self.shared_layout(snapshots)
        if not snapshots[nginx_path]["exists"]:
            raise RuntimeError("未找到 NAS 的 plugincenter.conf")
        nginx = self.original(snapshots[nginx_path]).decode()
        if "bililivereplay" in nginx:
            raise RuntimeError("Nginx 已有 bililivereplay 配置，拒绝重复部署")
        if not re.search(r"location\s+(?:\^~\s+)?/plugin\b", nginx):
            raise RuntimeError("没有识别到原有 /plugin 路由，拒绝修改")
        if re.search(r"location\s+\^~\s+/plugin\b", nginx):
            raise RuntimeError("/plugin 使用 ^~，当前代理模板无法安全接入，拒绝部署")
        for logical, snap in snapshots.items():
            if logical == nginx_path or not snap["exists"]:
                continue
            data = json.loads(self.original(snap))
            if not isinstance(data, dict):
                raise RuntimeError(f"JSON 根节点必须为对象：{logical}")
            if logical == list_path:
                if PLUGIN in data:
                    raise RuntimeError("同名插件已注册，拒绝覆盖")
                if any(isinstance(v, dict) and v.get("info", {}).get("id") == 109 for v in data.values()):
                    raise RuntimeError("插件数字 ID 109 已占用，拒绝覆盖")
            else:
                ports = data.get("ports", {})
                if not isinstance(ports, dict) or PLUGIN in ports:
                    raise RuntimeError(f"插件端口注册冲突：{logical}")
        if not snapshots[SHARED[0]]["exists"]:
            raise RuntimeError("未找到 /etc/config/plugin，无法验证 NAS 插件系统")
        account = pwd.getpwnam(f"u{uid}") if self.root == Path("/") else None
        if check_system:
            self.system.preflight(upstream)
        return {"uid": str(uid), "upstream": upstream, "port": port, "home": home,
                "owned": owned, "snapshots": snapshots, "list_path": list_path, "nginx_path": nginx_path,
                "shared_targets": shared_targets, "shared_aliases": shared_aliases,
                "account": [account.pw_uid, account.pw_gid] if account else None}

    def install(self, uid, upstream, package):
        package = Path(package).resolve()
        state = self.inspect(uid, upstream, package)
        if self.base.is_symlink():
            raise RuntimeError("状态目录是符号链接，拒绝操作")
        self.base.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.base, 0o700)
        stamp = time.strftime("%Y%m%d-%H%M%S") + "-" + os.urandom(3).hex()
        state.update({"schema": 2, "status": "installing", "backup_id": stamp, "created_dirs": [], "changed": [], "unit_enabled": False,
                      "cron": recovery_cron()})
        backup = self.base / "backups" / stamp
        backup.mkdir(parents=True, mode=0o700)
        state["backup"] = str(backup.relative_to(self.root))
        for logical, snap in state["snapshots"].items():
            if snap["exists"]:
                dest = backup / logical.lstrip("/")
                dest.parent.mkdir(parents=True, exist_ok=True)
                atomic(dest, self.original(snap), 0o600)
        block = render(uid, upstream)
        state["nginx_block"] = block
        info = json.loads((package / "INFO").read_text())
        info["port"] = str(state["port"])
        frontend = json.loads((package / "src/ui/config").read_text())
        state["entry"] = {"status": "running", "install": True, "upgrade": False, "enable": True,
            "changetime": int(time.time()), "icon": f"/icon/{PLUGIN}.icon", "progress": "100",
            "resource": {"mpk": state["home"] + "/INFO", "icon": f"/icon/{PLUGIN}.icon", "preview": []},
            "info": info, "frontend": frontend}
        self.save(state)
        try:
            # Keep recovery code even if the uploaded ZIP is deleted.
            # On undo, retain this manager's safe scheduling/rollback code even
            # when restoring v0.1.0's frontend. Read before replacing runtime:
            # this process may itself be running from that directory.
            runtime_files = {name: (Path(__file__).parent / name).read_bytes()
                             for name in ("manage.py", "nginx.py", "rollback.sh", "status.sh")}
            runtime = self.base / "runtime"
            if runtime.exists():
                shutil.rmtree(runtime)
            runtime.mkdir(mode=0o700)
            for name, content in runtime_files.items():
                atomic(runtime / name, content, 0o755 if name.endswith(".sh") else 0o600)
            home = self.path(state["home"])
            self.ensure_parent(home, state)
            state["changed"].append(state["home"])
            self.save(state)
            home.mkdir(mode=0o755)
            shutil.copytree(package / "src", home / "src")
            shutil.copytree(package / "scripts", home / "scripts")
            atomic(home / "INFO", (json.dumps(info, ensure_ascii=False, indent=2) + "\n").encode(), 0o644)
            # Native NAS CGI serves packaged static assets; no Docker HTML/JS rewriting.
            shutil.copy2(package / "deploy" / "static_cgi.py", home / "src/ui" / f"{PLUGIN}.cgi")
            os.chmod(home / "src/ui" / f"{PLUGIN}.cgi", 0o755)
            for item in home.rglob("*"):
                if item.is_file():
                    os.chmod(item, 0o755 if item.name in (f"{PLUGIN}.cgi", "control") else 0o644)
                elif item.is_dir():
                    os.chmod(item, 0o755)
                if state["account"]:
                    os.chown(item, *state["account"])
            if state["account"]:
                os.chown(home, *state["account"])
            for logical in state["owned"][1:]:
                self.ensure_parent(self.path(logical), state)
            for logical in state["owned"][1:3]:
                state["changed"].append(logical)
            self.save(state)
            os.symlink(str(home / "src/ui"), self.path(state["owned"][1]))
            shutil.copy2(package / "src/ui/icon.png", self.path(state["owned"][2]))
            os.chmod(self.path(state["owned"][2]), 0o644)
            for logical in [state["list_path"], *state["shared_targets"]]:
                snap = state["snapshots"][logical]
                if logical in SHARED and not snap["exists"]:
                    continue
                data = json.loads(self.original(snap)) if snap["exists"] else {}
                current = self.path(logical)
                if (current.exists() != snap["exists"] or
                        (current.exists() and current.read_bytes() != self.original(snap))):
                    raise RuntimeError(f"共享配置在部署过程中发生变化，已停止：{logical}")
                if logical == state["list_path"]:
                    data[PLUGIN] = state["entry"]
                else:
                    data.setdefault("ports", {})[PLUGIN] = {f"u{uid}": state["port"]}
                state["changed"].append(logical)
                state.setdefault("installed_shared", {})[logical] = data
                self.save(state)
                self.write_shared(logical, (json.dumps(data, ensure_ascii=False, indent=1) + "\n").encode(), state)
            logical = state["nginx_path"]
            state["changed"].append(logical)
            self.save(state)
            self.write_shared(logical, block.encode() + self.original(state["snapshots"][logical]), state)
            self.system.nginx_test()
            self.system.nginx_reload()
            logical = state["owned"][3]
            state["changed"].append(logical)
            self.save(state)
            unit = f"""[Unit]
Description=Restore local biliLive watch plugin entry
After=network.target nginx.service docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 {STATE}/runtime/manage.py restore
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
"""
            state["unit"] = unit
            self.save(state)
            atomic(self.path(logical), unit.encode(), 0o644)
            # Persistent payload, used only if NAS rebuilds plugin directories.
            payload = self.base / "payload"
            if payload.exists():
                shutil.rmtree(payload)
            shutil.copytree(home, payload)
            # Enabling an on-boot oneshot is just a wants symlink. Do not call
            # systemctl from a NAS PTY or recursively from the restore unit:
            # affected firmware can deadlock its D-Bus job queue.
            state["changed"].extend([UNIT_LINK, CRON])
            self.save(state)
            os.symlink(f"../{UNIT}", self.path(UNIT_LINK))
            state["unit_enabled"] = True
            self.save(state)
            atomic(self.path(CRON), state["cron"].encode(), 0o644)
            release = self.base / "releases" / stamp
            shutil.copytree(package, release)
            state["package_backup"] = str(release.relative_to(self.root))
            state["status"] = "installed"
            self.save(state)
        except BaseException:
            try:
                self.rollback(automatic=True)
            except Exception as rollback_error:
                state["status"] = "recovery_needed"
                self.save(state)
                print(f"自动回滚未完成：{rollback_error}。备份：{backup}", file=sys.stderr)
            raise
        return state

    def detect_uid(self):
        candidates = set()
        for folder, pattern in ((self.path("/home"), "u*"), (self.path("/data/plugin"), "u*.list")):
            for path in folder.glob(pattern):
                match = re.fullmatch(r"u([1-9][0-9]*)(?:\.list)?", path.name)
                if match:
                    candidates.add(match[1])
        if len(candidates) != 1:
            raise RuntimeError("无法唯一确定 NAS 用户，请加 --uid 数字UID 指定安装用户")
        return candidates.pop()

    def deploy(self, uid, upstream, package):
        if self.manifest.exists() and self.load()["status"] == "installed":
            current = self.load()
            verify_package(package)
            incoming = Path(package) / "MANIFEST.json"
            saved = self.path(current.get("package_backup", "")) / "MANIFEST.json"
            if (str(uid) == current["uid"] and upstream == current["upstream"]
                    and incoming.is_file() and saved.is_file()
                    and incoming.read_bytes() == saved.read_bytes()):
                self.rollback_plan(current)
                return current  # Installing the same verified release is a no-op.
            return self.upgrade(uid, upstream, package)
        return self.install(uid, upstream, package)

    def upgrade(self, uid, upstream, package, remember=True):
        previous = self.load()
        if previous["status"] != "installed" or str(uid) != previous["uid"]:
            raise RuntimeError("升级仅支持已安装的同一用户；请先检查部署状态")
        validate_upstream(upstream)
        verify_package(package)
        # Validate the complete new distribution before removing the working version.
        for name in ("INFO", "src/ui/index.html", "src/ui/config", "src/ui/icon.png", "deploy/manage.py", "deploy/nginx.py", "deploy/static_cgi.py", "scripts/control"):
            if not (Path(package) / name).is_file():
                raise RuntimeError(f"升级包不完整：缺少 {name}")
        old_package = self.path(previous.get("package_backup", ""))
        if not previous.get("package_backup") or not old_package.is_dir():
            raise RuntimeError("缺少上一版安装包备份，停止升级")
        verify_package(old_package)
        self.rollback_plan(previous)
        self.system.preflight(upstream)
        self.rollback()
        try:
            state = self.install(uid, upstream, package)
        except BaseException as error:
            if self.load()["status"] != "rolled_back":
                raise RuntimeError("升级失败，配置需人工恢复；请保留状态目录和备份") from error
            try:
                restored = self.install(previous["uid"], previous["upstream"], old_package)
                for key in ("previous_package", "previous_upstream", "update_undone"):
                    if key in previous:
                        restored[key] = previous[key]
                self.save(restored)
            except BaseException as restore_error:
                raise RuntimeError(f"升级失败且旧版恢复未完成：{restore_error}；上一版安装包：{old_package}") from error
            raise RuntimeError("升级失败，已自动恢复上一版插件；Docker 和观看数据保留") from error
        if remember:
            state["previous_package"] = previous["package_backup"]
            state["previous_upstream"] = previous["upstream"]
            self.save(state)
        return state

    def undo(self):
        state = self.load()
        if state.get("update_undone") or state["status"] == "rolled_back":
            return state
        if state.get("previous_package"):
            restored = self.upgrade(state["uid"], state["previous_upstream"], self.path(state["previous_package"]), remember=False)
            restored["update_undone"] = True
            self.save(restored)
            return restored
        return self.rollback()

    def rollback_plan(self, state, observed=None):
        plan = {}
        shared_targets = self.state_shared_targets(state)
        for logical in state["changed"]:
            if logical not in state["snapshots"]:
                continue
            if logical in SHARED and logical not in shared_targets:
                continue
            path = self.path(logical)
            if path.is_symlink():
                raise RuntimeError(f"配置被替换成符号链接：{logical}")
            snap = state["snapshots"][logical]
            original = self.original(snap) if snap["exists"] else None
            if not path.exists():
                if snap["exists"]:
                    raise RuntimeError(f"共享配置已丢失，拒绝覆盖：{logical}")
                continue
            snap_now = self.snapshot(path)
            current = self.original(snap_now)
            if observed is not None:
                observed[logical] = snap_now
            if original is not None and current == original:
                continue  # A previous rollback may already have restored this file.
            if logical == state["nginx_path"]:
                updated = remove_block(current.decode(), state["uid"], state["nginx_block"]).encode()
                plan[logical] = updated
                continue
            data = json.loads(current)
            container = data if logical == state["list_path"] else data.get("ports", {})
            expected = state["entry"] if logical == state["list_path"] else {f"u{state['uid']}": state["port"]}
            if PLUGIN in container:
                matches = same_entry(container[PLUGIN], expected) if logical == state["list_path"] else container[PLUGIN] == expected
                if not matches:
                    raise RuntimeError(f"插件注册项被修改，回滚已停止：{logical}")
                del container[PLUGIN]
            if original is None:
                plan[logical] = None if not data else (json.dumps(data, ensure_ascii=False, indent=1) + "\n").encode()
            elif data == json.loads(original):
                plan[logical] = original  # Byte-for-byte restore when unrelated fields are unchanged.
            else:
                plan[logical] = (json.dumps(data, ensure_ascii=False, indent=1) + "\n").encode()
        self.check_recovery_files(state)
        return plan

    def check_recovery_files(self, state):
        for logical, expected in ((UNIT_PATH, state.get("unit")), (CRON, state.get("cron"))):
            if logical not in state["changed"] or not os.path.lexists(self.path(logical)):
                continue
            path = self.path(logical)
            if path.is_symlink() or not path.is_file() or path.read_text() != expected:
                raise RuntimeError(f"自动恢复配置已被修改，停止操作：{logical}")
        # Also recognize the link created by v0.1.0's systemctl enable.
        link = self.path(UNIT_LINK)
        if (state.get("unit_enabled") or UNIT_LINK in state["changed"]) and os.path.lexists(link):
            if not link.is_symlink() or os.readlink(link) not in (f"../{UNIT}", UNIT_PATH, str(self.path(UNIT_PATH))):
                raise RuntimeError("开机恢复链接被其他配置占用，停止操作")

    def stop_recovery(self, state):
        # Caller has saved rolling_back and holds the same flock as cron/boot.
        # Never stop a systemd job while holding the lock that job may need.
        if CRON in state["changed"]:
            self.path(CRON).unlink(missing_ok=True)
        if state.get("unit_enabled") or UNIT_LINK in state["changed"]:
            self.path(UNIT_LINK).unlink(missing_ok=True)

    def rollback(self, automatic=False):
        state = self.load()
        if state["status"] == "rolled_back":
            return state
        current = {}
        plan = self.rollback_plan(state, current)  # Detect conflicts before any write.
        state["status"] = "rolling_back"
        self.save(state)  # Restore service refuses to re-create a rolling-back plugin.
        self.stop_recovery(state)  # Disable scheduling BEFORE removing any registration.
        applied = {}
        try:
            for logical, value in plan.items():
                path = self.path(logical)
                if self.snapshot(path) != current[logical]:
                    raise RuntimeError(f"共享配置在回滚过程中发生变化，已停止：{logical}")
                if value is None:
                    path.unlink(missing_ok=True)
                else:
                    snap = state["snapshots"][logical]
                    atomic(path, value, snap.get("mode", 0o644), (snap["uid"], snap["gid"]) if snap["exists"] and os.geteuid() == 0 else None)
                applied[logical] = value
            self.system.nginx_test()
            self.system.nginx_reload()
        except Exception:
            for logical, value in applied.items():
                path = self.path(logical)
                # An unrelated writer does not honor our deployment lock. Never
                # overwrite changes made after this rollback's own write.
                actual = self.snapshot(path)
                if actual["exists"] != (value is not None) or (actual["exists"] and self.original(actual) != value):
                    continue
                snap = current[logical]
                if snap["exists"]:
                    atomic(path, self.original(snap), snap["mode"])
                else:
                    path.unlink(missing_ok=True)
            state["status"] = "recovery_needed"
            self.save(state)
            raise
        # Remove only resources this transaction created; container/data untouched.
        for logical in reversed(state["owned"]):
            if logical not in state["changed"]:
                continue
            path = self.path(logical)
            if path.is_symlink() or path.is_file():
                path.unlink()
            elif path.is_dir():
                shutil.rmtree(path)
        for logical in reversed(state["created_dirs"]):
            try:
                self.path(logical).rmdir()
            except (FileNotFoundError, OSError):
                pass
        state["status"] = "rolled_back"
        self.save(state)
        return state

    def restore(self):
        if not self.manifest.exists():
            return
        try:
            state = self.load()
            if state["status"] != "installed":
                return
            self.restore_installed(state)
        except Exception as error:
            self.recovery_result("error", str(error))
            raise
        self.recovery_result("ok")

    def recovery_result(self, status, message=""):
        atomic(self.base / "recovery.json", (json.dumps({
            "status": status, "checked_at": int(time.time()), "message": message[:512],
        }, ensure_ascii=False) + "\n").encode(), 0o600)

    def restore_installed(self, state):
        # Both boot and cron call this directly, without systemctl or Docker.
        self.check_recovery_files(state)
        updates = []
        for logical in [state["list_path"], *self.state_shared_targets(state)]:
            path = self.path(logical)
            if logical in SHARED and not path.exists():
                continue
            snap = self.snapshot(path)
            data = json.loads(self.original(snap)) if snap["exists"] else {}
            if not isinstance(data, dict):
                raise RuntimeError(f"插件配置格式无法识别：{logical}")
            container = data if logical == state["list_path"] else data.setdefault("ports", {})
            if not isinstance(container, dict):
                raise RuntimeError(f"插件端口配置格式无法识别：{logical}")
            expected = state["entry"] if logical == state["list_path"] else {f"u{state['uid']}": state["port"]}
            if PLUGIN in container:
                matches = same_entry(container[PLUGIN], expected) if logical == state["list_path"] else container[PLUGIN] == expected
                if not matches:
                    raise RuntimeError(f"插件注册项有冲突：{logical}")
            else:
                if logical == state["list_path"] and any(isinstance(entry, dict) and entry.get("info", {}).get("id") == 109 for entry in data.values()):
                    raise RuntimeError("插件数字 ID 109 已被其他插件占用，停止恢复")
                container[PLUGIN] = expected
                updates.append((logical, snap, (json.dumps(data, ensure_ascii=False, indent=1) + "\n").encode()))
        nginx_path = self.path(state["nginx_path"])
        nginx_snap = self.snapshot(nginx_path)
        if not nginx_snap["exists"]:
            raise RuntimeError("NAS 的 plugincenter.conf 缺失，停止恢复；请先恢复 NAS 原生插件服务")
        current = self.original(nginx_snap).decode()
        start, end = markers(state["uid"])
        missing_nginx = start not in current and end not in current
        if not missing_nginx and current.count(state["nginx_block"]) != 1:
            raise RuntimeError("插件 Nginx 配置有冲突，停止恢复")
        home = self.path(state["home"])
        if home.is_symlink():
            raise RuntimeError("插件目录被替换为符号链接")
        if not home.exists():
            home.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(self.base / "payload", home)
            if state["account"]:
                for item in [home, *home.rglob("*")]:
                    os.chown(item, *state["account"])
        else:
            # Cleanup interrupted halfway can leave an empty/partial directory.
            # Only fill missing packaged files; preserve existing local content.
            payload = self.base / "payload"
            for source in sorted(payload.rglob("*")):
                target = home / source.relative_to(payload)
                if target.is_symlink() or (target.exists() and target.is_dir() != source.is_dir()):
                    raise RuntimeError(f"插件文件路径被占用，停止恢复：{target}")
                if not target.exists():
                    if source.is_dir():
                        target.mkdir()
                        os.chmod(target, stat.S_IMODE(source.stat().st_mode))
                    else:
                        shutil.copy2(source, target)
                    if state["account"]:
                        os.chown(target, *state["account"])
        link = self.path(state["owned"][1])
        link.parent.mkdir(parents=True, exist_ok=True)
        if not os.path.lexists(link):
            os.symlink(str(home / "src/ui"), link)
        elif not link.is_symlink() or os.readlink(link) != str(home / "src/ui"):
            raise RuntimeError("插件 www 路径被占用，停止恢复")
        icon = self.path(state["owned"][2])
        if icon.is_symlink() or (icon.exists() and not icon.is_file()):
            raise RuntimeError("插件图标路径被占用，停止恢复")
        if not icon.exists():
            icon.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.base / "payload/src/ui/icon.png", icon)
        for logical, snap, content in updates:
            path = self.path(logical)
            if self.snapshot(path) != snap:
                raise RuntimeError(f"共享配置在恢复过程中发生变化，留待下次检查：{logical}")
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic(path, content, None if path.exists() else 0o644)
        if missing_nginx:
            if self.snapshot(nginx_path) != nginx_snap:
                raise RuntimeError("Nginx 配置在恢复过程中发生变化，留待下次检查")
            installed = state["nginx_block"].encode() + current.encode()
            atomic(nginx_path, installed)
            try:
                self.system.nginx_test()
                self.system.nginx_reload()
            except Exception:
                if not nginx_path.is_symlink() and nginx_path.read_bytes() == installed:
                    atomic(nginx_path, current.encode())
                raise
        # A firmware/market cleanup may also remove our scheduler or boot unit.
        for logical, content in ((UNIT_PATH, state["unit"]), (CRON, state.get("cron"))):
            if content is not None and not self.path(logical).exists():
                self.path(logical).parent.mkdir(parents=True, exist_ok=True)
                atomic(self.path(logical), content.encode(), 0o644)
        if not os.path.lexists(self.path(UNIT_LINK)):
            self.path(UNIT_LINK).parent.mkdir(parents=True, exist_ok=True)
            os.symlink(f"../{UNIT}", self.path(UNIT_LINK))

    def status(self):
        if not self.manifest.exists():
            return {"status": "not_installed"}
        state = self.load()
        result = {key: state[key] for key in ("status", "uid", "upstream", "backup_id", "backup")}
        for key in ("shared_targets", "shared_aliases"):
            if key in state:
                result[key] = state[key]
        result["auto_recovery"] = {
            "interval_seconds": 120,
            "enabled": state["status"] == "installed" and self.path(CRON).is_file() and self.path(CRON).read_text() == state.get("cron"),
            "cron_file": CRON,
        }
        recovery = self.base / "recovery.json"
        if recovery.is_file():
            result["auto_recovery"]["last_check"] = json.loads(recovery.read_text())
        return result


def main():
    # NAS PTY/noninteractive sessions can omit administrative command paths.
    os.environ["PATH"] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:" + os.environ.get("PATH", "")
    parser = argparse.ArgumentParser(description="小米 NAS 录播观看插件：部署、检查与回滚")
    parser.add_argument("action", choices=["check", "install", "rollback", "undo", "restore", "status"])
    parser.add_argument("--uid", help="米家用户数字 UID，不带 u")
    parser.add_argument("--upstream", default=None, help="已有 fullstack 容器映射端口（默认 3000）")
    parser.add_argument("--package", default=str(Path(__file__).resolve().parent.parent))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("请在 NAS 上以 root 执行；脚本不会自动开启 SSH 或提权")
    manager = Manager()
    try:
        with manager.lock():
            if args.action in ("check", "install"):
                current = manager.load() if manager.manifest.exists() else {}
                args.uid = args.uid or current.get("uid") or manager.detect_uid()
                args.upstream = args.upstream or current.get("upstream") or "http://127.0.0.1:3000"
                if args.action == "check":
                    checked = manager.inspect(args.uid, args.upstream, args.package)
                    for alias, target in checked["shared_aliases"].items():
                        print(f"配置映射：{alias} 与 {target} 共用底层配置，仅通过 {target} 写入。")
                    print("检查通过。未修改 NAS 配置；未测试 App 外网视频通道。")
                else:
                    state = manager.deploy(args.uid, args.upstream, args.package)
                    print(f"部署完成。请完全退出并重新打开 NAS App。备份：/{state['backup']}")
                    print(f"回滚：sh {STATE}/runtime/rollback.sh")
            elif args.action in ("rollback", "undo"):
                if not manager.manifest.exists():
                    print("没有部署记录，无需回滚。")
                else:
                    state = manager.undo() if args.action == "undo" else manager.rollback()
                    print(f"回滚完成，当前状态：{state['status']}。容器、录像和观看进度保留。备份：/{state['backup']}")
            elif args.action == "restore":
                manager.restore()
            else:
                print(json.dumps(manager.status(), ensure_ascii=False, indent=2))
    except BlockingIOError:
        if args.action == "restore":
            return 0  # An install, rollback, or another restore owns the lock.
        print("操作未完成：另一个部署或恢复任务正在运行，请稍后重试。", file=sys.stderr)
        return 1
    except (Exception, KeyboardInterrupt) as error:
        print(f"操作未完成：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
