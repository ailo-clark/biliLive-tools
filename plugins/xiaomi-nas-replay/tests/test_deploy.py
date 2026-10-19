import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "deploy"))
from manage import Manager, PLUGIN, SHARED, UNIT, System, backing_path, verify_package
from nginx import render, remove_block, validate_upstream
from static_cgi import serve


class FakeSystem:
    def __init__(self):
        self.events = []
        self.fail_test_once = False
        self.fail_reload_once = False
        self.fail_enable_once = False
        self.enabled = False

    def preflight(self, upstream):
        self.events.append("preflight")

    def nginx_test(self):
        self.events.append("test")
        if self.fail_test_once:
            self.fail_test_once = False
            raise RuntimeError("simulated invalid nginx config")

    def nginx_reload(self):
        self.events.append("reload")
        if self.fail_reload_once:
            self.fail_reload_once = False
            raise RuntimeError("simulated nginx reload failure")

    def daemon_reload(self):
        self.events.append("daemon-reload")

    def enable(self):
        self.events.append("enable")
        self.enabled = True
        if self.fail_enable_once:
            self.fail_enable_once = False
            raise RuntimeError("simulated partial systemctl enable failure")

    def disable(self):
        self.events.append("disable")
        self.enabled = False


class Deployment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.system = FakeSystem()
        self.manager = Manager(self.root, self.system)
        self.uid = "12345"
        self.baseline = {
            "/etc/nginx/conf.d/luci/plugincenter.conf": b"# original\nlocation /plugin { return 200; }\n",
            "/data/plugin/u12345.list": b'{"existing":{"info":{"id":99},"custom":"preserve"}}\n',
            SHARED[0]: b'{"ports":{"reserve":true,"existing":{"u12345":9301}},"extra":17}\n',
            SHARED[1]: b'{"ports":{"reserve":true},"overlay":true}\n',
            "/original-data/app.db": b"original-db-do-not-touch\x00",
            "/original-data/watch-history.db": b"watch-progress-do-not-touch\x00",
            "/original-video/live.mp4": b"video-do-not-touch\x00",
        }
        for logical, data in self.baseline.items():
            path = self.manager.path(logical)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o640)
        self.manager.path("/tmp").mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def install(self):
        return self.manager.install(self.uid, "http://127.0.0.1:3000", ROOT)

    def assert_original(self):
        for logical, data in self.baseline.items():
            self.assertEqual(self.manager.path(logical).read_bytes(), data, logical)
            self.assertEqual(stat.S_IMODE(self.manager.path(logical).stat().st_mode), 0o640, logical)
        state = self.manager.load()
        for logical in state["owned"]:
            self.assertFalse(os.path.lexists(self.manager.path(logical)), logical)
        self.assertFalse(self.system.enabled)

    def test_check_does_not_modify_configuration(self):
        self.manager.inspect(self.uid, "http://127.0.0.1:3000", ROOT)
        self.assertFalse(self.manager.base.exists())
        for logical, data in self.baseline.items():
            self.assertEqual(self.manager.path(logical).read_bytes(), data)

    def test_install_and_byte_exact_rollback(self):
        state = self.install()
        self.assertEqual(state["status"], "installed")
        link = self.manager.path(state["owned"][1])
        self.assertTrue(link.is_symlink())
        self.assertEqual(link.resolve(), self.manager.path(state["home"]) / "src/ui")
        self.assertTrue((link / "index.html").exists())
        self.assertTrue(any((link / "assets").glob("*.js")))
        self.assertFalse((link / "web").exists())
        self.assertFalse((link.resolve().parent / "proxy.json").exists())
        self.assertEqual(stat.S_IMODE(self.manager.base.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.manager.manifest.stat().st_mode), 0o600)
        self.assertEqual(self.manager.rollback()["status"], "rolled_back")
        self.assert_original()

    def test_nginx_validation_failure_auto_rolls_back(self):
        self.system.fail_test_once = True
        with self.assertRaisesRegex(RuntimeError, "invalid nginx"):
            self.install()
        self.assertEqual(self.manager.load()["status"], "rolled_back")
        self.assert_original()

    def test_nginx_reload_failure_auto_rolls_back(self):
        self.system.fail_reload_once = True
        with self.assertRaisesRegex(RuntimeError, "reload failure"):
            self.install()
        self.assert_original()

    def test_partial_systemctl_enable_auto_rolls_back(self):
        self.system.fail_enable_once = True
        with self.assertRaisesRegex(RuntimeError, "partial systemctl"):
            self.install()
        self.assert_original()

    def test_existing_other_plugin_changes_survive_rollback(self):
        state = self.install()
        for logical in [state["list_path"], *SHARED]:
            path = self.manager.path(logical)
            data = json.loads(path.read_text())
            data["new-user-setting"] = {"keep": True}
            path.write_text(json.dumps(data))
        nginx = self.manager.path(state["nginx_path"])
        nginx.write_text(nginx.read_text() + "# another plugin added later\n")
        self.manager.rollback()
        for logical in [state["list_path"], *SHARED]:
            data = json.loads(self.manager.path(logical).read_text())
            self.assertTrue(data["new-user-setting"]["keep"])
            self.assertNotIn(PLUGIN, data if logical == state["list_path"] else data["ports"])
        self.assertTrue(nginx.read_text().endswith("# another plugin added later\n"))

    def test_runtime_status_changes_allow_rollback(self):
        state = self.install()
        path = self.manager.path(state["list_path"])
        data = json.loads(path.read_text())
        data[PLUGIN].update(status="stopped", enable=False, changetime=123)
        data[PLUGIN]["info"]["timestamp"] = 456
        path.write_text(json.dumps(data))
        self.manager.rollback()
        self.assert_original()

    def test_edited_plugin_config_stops_rollback_before_any_write(self):
        state = self.install()
        path = self.manager.path(state["list_path"])
        data = json.loads(path.read_text())
        data[PLUGIN]["frontend"]["title"] = "user changed"
        path.write_text(json.dumps(data))
        old_nginx = self.manager.path(state["nginx_path"]).read_bytes()
        with self.assertRaisesRegex(RuntimeError, "被修改"):
            self.manager.rollback()
        self.assertEqual(self.manager.path(state["nginx_path"]).read_bytes(), old_nginx)
        self.assertTrue(self.system.enabled)

    def test_modified_nginx_block_stops_rollback(self):
        state = self.install()
        path = self.manager.path(state["nginx_path"])
        path.write_text(path.read_text().replace("3600s", "30s"))
        with self.assertRaisesRegex(RuntimeError, "被修改"):
            self.manager.rollback()

    def test_bad_backup_hash_stops_rollback(self):
        state = self.install()
        state["snapshots"][SHARED[0]]["data"] = base64.b64encode(b"tampered").decode()
        self.manager.save(state)
        with self.assertRaisesRegex(RuntimeError, "备份校验失败"):
            self.manager.rollback()

    def test_rollback_failure_preserves_installed_configuration(self):
        state = self.install()
        before = {logical: self.manager.path(logical).read_bytes() for logical in state["snapshots"]}
        self.system.fail_test_once = True
        with self.assertRaises(RuntimeError):
            self.manager.rollback()
        self.assertEqual(self.manager.load()["status"], "recovery_needed")
        for logical, data in before.items():
            self.assertEqual(self.manager.path(logical).read_bytes(), data)
        self.manager.rollback()
        self.assert_original()

    def test_rollback_is_repeatable(self):
        self.install()
        self.manager.rollback()
        event_count = len(self.system.events)
        self.manager.rollback()
        self.assertEqual(len(self.system.events), event_count)
        self.assert_original()

    def test_second_install_is_rejected_without_overwrite(self):
        state = self.install()
        before = self.manager.path(state["nginx_path"]).read_bytes()
        with self.assertRaisesRegex(RuntimeError, "已有部署"):
            self.install()
        self.assertEqual(self.manager.path(state["nginx_path"]).read_bytes(), before)

    def test_reinstall_after_rollback_keeps_previous_backup(self):
        old = self.install()
        self.manager.rollback()
        new = self.install()
        self.assertNotEqual(old["backup_id"], new["backup_id"])
        self.assertTrue(self.manager.path(old["backup"]).exists())
        self.manager.rollback()
        self.assert_original()

    def test_boot_restore_then_rollback(self):
        state = self.install()
        shutil.rmtree(self.manager.path(state["home"]))
        self.manager.path(state["owned"][1]).unlink()
        self.manager.path(state["owned"][2]).unlink()
        self.manager.path(state["list_path"]).write_bytes(self.baseline[state["list_path"]])
        self.manager.path(state["nginx_path"]).write_bytes(self.baseline[state["nginx_path"]])
        self.manager.restore()
        self.assertTrue(self.manager.path(state["home"] + "/src/ui/index.html").exists())
        self.assertTrue(any(self.manager.path(state["home"] + "/src/ui/assets").glob("*.js")))
        self.assertFalse(self.manager.path(state["home"] + "/src/proxy.json").exists())
        self.assertIn(PLUGIN, json.loads(self.manager.path(state["list_path"]).read_text()))
        self.assertIn(state["nginx_block"], self.manager.path(state["nginx_path"]).read_text())
        self.manager.rollback()
        self.assert_original()

    def test_boot_after_rollback_does_not_recreate_plugin(self):
        self.install()
        self.manager.rollback()
        self.manager.restore()
        self.assert_original()

    def test_missing_initial_list_removed_on_rollback(self):
        logical = "/data/plugin/u12345.list"
        self.manager.path(logical).unlink()
        self.baseline.pop(logical)
        self.install()
        self.manager.rollback()
        self.assertFalse(self.manager.path(logical).exists())
        self.assert_original()

    def test_absent_overlay_config_is_not_created(self):
        self.manager.path(SHARED[1]).unlink()
        self.baseline.pop(SHARED[1])
        self.install()
        self.assertFalse(self.manager.path(SHARED[1]).exists())
        self.manager.rollback()
        self.assert_original()

    def alias_shared_config(self):
        merged, upper = (self.manager.path(path) for path in SHARED)
        upper.unlink()
        upper.parent.rmdir()
        upper.parent.symlink_to(merged.parent, target_is_directory=True)
        self.baseline[SHARED[1]] = self.baseline[SHARED[0]]
        return merged, upper

    def test_mapped_config_is_written_once_and_rollback_restores_both_paths(self):
        self.alias_shared_config()
        state = self.install()
        self.assertEqual(state["shared_targets"], [SHARED[0]])
        self.assertEqual(state["shared_aliases"], {SHARED[1]: SHARED[0]})
        self.assertNotIn(SHARED[1], state["changed"])
        self.assertEqual(self.manager.path(SHARED[0]).read_bytes(), self.manager.path(SHARED[1]).read_bytes())
        self.manager.rollback()
        self.assert_original()

    def test_mapped_config_auto_rollback_after_nginx_reload_failure(self):
        self.alias_shared_config()
        self.system.fail_reload_once = True
        with self.assertRaisesRegex(RuntimeError, "reload failure"):
            self.install()
        self.assert_original()

    def test_mapped_config_boot_restore_then_rollback(self):
        merged, upper = self.alias_shared_config()
        state = self.install()
        merged.write_bytes(self.baseline[SHARED[0]])
        self.manager.path(state["list_path"]).write_bytes(self.baseline[state["list_path"]])
        self.manager.path(state["nginx_path"]).write_bytes(self.baseline[state["nginx_path"]])
        self.manager.restore()
        self.assertIn(PLUGIN, json.loads(merged.read_text())["ports"])
        self.assertEqual(merged.read_bytes(), upper.read_bytes())
        self.manager.rollback()
        self.assert_original()

    def test_mapped_config_preserves_unrelated_later_changes(self):
        merged, upper = self.alias_shared_config()
        self.install()
        data = json.loads(merged.read_text())
        data["another-plugin-added-later"] = {"keep": True}
        merged.write_text(json.dumps(data))
        self.manager.rollback()
        self.assertTrue(json.loads(merged.read_text())["another-plugin-added-later"]["keep"])
        self.assertNotIn(PLUGIN, json.loads(merged.read_text())["ports"])
        self.assertEqual(merged.read_bytes(), upper.read_bytes())

    def test_legacy_journal_recovery_skips_raw_alias(self):
        _, upper = self.alias_shared_config()
        state = self.install()
        state.pop("shared_targets")
        state.pop("shared_aliases")
        state["changed"].append(SHARED[1])
        self.manager.save(state)
        from manage import atomic
        def checked_atomic(path, *args, **kwargs):
            self.assertNotEqual(Path(path), upper, "Never modify an overlay's raw upper alias")
            return atomic(path, *args, **kwargs)
        with patch("manage.atomic", side_effect=checked_atomic):
            self.manager.rollback()
        self.assert_original()

    def test_identical_independent_configs_are_both_updated(self):
        self.manager.path(SHARED[1]).write_bytes(self.baseline[SHARED[0]])
        self.baseline[SHARED[1]] = self.baseline[SHARED[0]]
        state = self.install()
        self.assertEqual(state["shared_targets"], SHARED)
        self.assertEqual(state["shared_aliases"], {})
        for logical in SHARED:
            self.assertIn(PLUGIN, json.loads(self.manager.path(logical).read_text())["ports"])
        self.manager.rollback()
        self.assert_original()

    def test_real_external_change_during_install_still_stops_and_preserves_change(self):
        original_write = self.manager.write_shared
        def write_and_change_independent_config(logical, data, state):
            original_write(logical, data, state)
            if logical == SHARED[0]:
                path = self.manager.path(SHARED[1])
                external = json.loads(path.read_text())
                external["external-change"] = True
                path.write_text(json.dumps(external))
                self.baseline[SHARED[1]] = path.read_bytes()
        self.manager.write_shared = write_and_change_independent_config
        with self.assertRaisesRegex(RuntimeError, "共享配置在部署过程中发生变化"):
            self.install()
        self.assertTrue(json.loads(self.manager.path(SHARED[1]).read_text())["external-change"])
        self.assert_original()

    def test_uid_and_upstream_input_rejected(self):
        for uid in ("", "u123", "../123", "123;touch /tmp/x", "0"):
            with self.subTest(uid=uid), self.assertRaises(ValueError):
                self.manager.inspect(uid, "http://127.0.0.1:3000", ROOT)
        for upstream in ("http://example.com:3000", "https://127.0.0.1:3000", "http://u:p@127.0.0.1:3000", "http://127.0.0.1:3000/api", "http://127.0.0.1:3000?x=1", "http://127.0.0.1:70000"):
            with self.subTest(upstream=upstream), self.assertRaises(ValueError):
                validate_upstream(upstream)

    def test_existing_plugin_directory_is_not_overwritten(self):
        path = self.manager.path("/home/u12345/plugin/" + PLUGIN)
        path.mkdir(parents=True)
        with self.assertRaisesRegex(RuntimeError, "目标已存在"):
            self.install()

    def test_existing_numeric_id_is_not_overwritten(self):
        path = self.manager.path("/data/plugin/u12345.list")
        path.write_text('{"another":{"info":{"id":109}}}')
        with self.assertRaisesRegex(RuntimeError, "109 已占用"):
            self.install()

    def test_symlink_config_is_not_followed(self):
        path = self.manager.path(SHARED[0])
        original = self.root / "private"
        path.rename(original)
        path.symlink_to(original)
        with self.assertRaisesRegex(RuntimeError, "不是普通文件"):
            self.install()
        self.assertEqual(original.read_bytes(), self.baseline[SHARED[0]])

    def test_nginx_prefix_caret_modifier_is_rejected(self):
        path = self.manager.path("/etc/nginx/conf.d/luci/plugincenter.conf")
        path.write_text("location ^~ /plugin { return 403; }\n")
        with self.assertRaisesRegex(RuntimeError, r"\^~"):
            self.install()

    def test_unrecognized_state_directory_is_not_overwritten(self):
        self.manager.base.mkdir(parents=True)
        (self.manager.base / "keep.txt").write_text("user file")
        with self.assertRaisesRegex(RuntimeError, "缺少部署记录"):
            self.install()
        self.assertEqual((self.manager.base / "keep.txt").read_text(), "user file")

    def test_recovery_journal_can_replace_damaged_state(self):
        state = self.install()
        recovery = self.manager.path(state["backup"]) / "deployment.json"
        self.assertEqual(json.loads(recovery.read_text()), self.manager.load())
        self.manager.manifest.write_text("damaged")
        shutil.copyfile(recovery, self.manager.manifest)
        self.manager.rollback()
        self.assert_original()
        self.assertEqual(json.loads(recovery.read_text())["status"], "rolled_back")

    def test_real_nginx_validates_installed_and_rolled_back_files(self):
        binary = os.environ.get("NGINX_BIN") or shutil.which("nginx") or "/workspace/cloud-setup/tools/nginx-proxy/sbin/nginx"
        if not Path(binary).is_file():
            self.skipTest("nginx binary is unavailable")
        (self.root / "logs").mkdir()
        config = self.root / "nginx.conf"
        temporary = " ".join(f"{module}_temp_path {self.root}/{module};" for module in ("client_body", "proxy", "fastcgi", "uwsgi", "scgi"))
        config.write_text(f"pid {self.root}/nginx.pid;\nerror_log {self.root}/nginx.log;\nevents {{}}\nhttp {{ access_log off; {temporary} server {{ listen 127.0.0.1:18045; set $need_reject 1; include {self.manager.path('/etc/nginx/conf.d/luci/plugincenter.conf')}; }} }}\n")
        old = self.system.nginx_test
        def nginx_test():
            old()
            result = subprocess.run([binary, "-p", str(self.root) + "/", "-c", str(config), "-t"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.system.nginx_test = nginx_test
        self.install()
        self.manager.rollback()
        self.assert_original()


class SharedMountLayout(unittest.TestCase):
    def test_overlay_merged_path_matches_raw_upper_path(self):
        mounts = ("1 0 8:1 / / rw - ext4 /dev/root rw\n"
                  "2 1 0:5 / /etc rw - overlay overlay rw,lowerdir=/rom/etc,upperdir=/data/etc/upper,workdir=/data/etc/work\n")
        self.assertEqual(backing_path("/etc/config/plugin", mounts), Path("/data/etc/upper/config/plugin"))
        self.assertEqual(backing_path("/data/etc/upper/config/plugin", mounts), Path("/data/etc/upper/config/plugin"))

    def test_more_specific_mount_prevents_false_overlay_alias(self):
        mounts = ("1 0 8:1 / / rw - ext4 /dev/root rw\n"
                  "2 1 0:5 / /etc rw - overlay overlay rw,upperdir=/data/etc/upper\n"
                  "3 2 0:6 / /etc/config rw - tmpfs tmpfs rw\n")
        self.assertEqual(backing_path("/etc/config/plugin", mounts), Path("/etc/config/plugin"))

    def test_mountinfo_escaped_paths_and_unavailable_metadata(self):
        mounts = ("malformed\n"
                  "1 0 8:1 / / rw - ext4 /dev/root rw\n"
                  "2 1 0:5 / /etc rw - overlay overlay rw,upperdir=/data/etc\\040state/upper\n")
        self.assertEqual(backing_path("/etc/config/plugin", mounts), Path("/data/etc state/upper/config/plugin"))
        self.assertEqual(backing_path("/etc/config/plugin", ""), Path("/etc/config/plugin"))


class PackageIntegrity(unittest.TestCase):
    def test_detects_changed_file(self):
        import hashlib
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "file.txt").write_bytes(b"original")
            (root / "MANIFEST.json").write_text(json.dumps({"files": {"file.txt": hashlib.sha256(b"original").hexdigest()}}))
            verify_package(root)
            (root / "file.txt").write_bytes(b"modified")
            with self.assertRaisesRegex(RuntimeError, "校验失败"):
                verify_package(root)

    def test_rejects_manifest_path_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "MANIFEST.json").write_text(json.dumps({"files": {"../outside": "invalid"}}))
            with self.assertRaisesRegex(RuntimeError, "路径异常"):
                verify_package(root)


class ProxyPreflight(unittest.TestCase):
    def fake_system(self, with_sub):
        from types import SimpleNamespace
        class Probe(System):
            def run(self, args, ok=(0,)):
                if args[1] == "-T":
                    return SimpleNamespace(stdout="plugincenter.conf $need_reject", stderr="", returncode=0)
                return SimpleNamespace(stdout="", stderr="--with-http_sub_module" if with_sub else "", returncode=0)
        return Probe()

    def test_missing_sub_module_no_longer_blocks_install(self):
        with patch("manage.shutil.which", return_value="/fake/bin"):
            self.fake_system(False).preflight("http://127.0.0.1:3000", no_probe=True)

    def test_nginx_with_sub_module_remains_compatible(self):
        from unittest.mock import patch
        with patch("manage.shutil.which", return_value="/fake/bin"):
            self.fake_system(True).preflight("http://127.0.0.1:3000", no_probe=True)

    def test_proxy_does_not_claim_nas_root_api(self):
        block = render("12345", "http://127.0.0.1:3000")
        self.assertNotIn("location /api", block)
        self.assertNotIn("sub_filter", block)
        self.assertIn("proxy_pass http://127.0.0.1:3000", block)
        self.assertFalse((ROOT / "src/ui/web").exists())
        self.assertFalse((ROOT / "frontend").exists())


class StaticCGI(unittest.TestCase):
    def test_entry_streaming_and_mime(self):
        out = io.BytesIO()
        serve(ROOT / "src/ui", ROOT / "src/ui/index.html", out)
        headers, body = out.getvalue().split(b"\r\n\r\n", 1)
        self.assertIn(b"Content-Type: text/html", headers)
        self.assertEqual(body, (ROOT / "src/ui/index.html").read_bytes())

    def test_external_path_cgi_and_directories_rejected(self):
        for requested in (ROOT / "INFO", ROOT / "src/ui", ROOT / "deploy/static_cgi.py", ROOT / "src/ui/../secret"):
            out = io.BytesIO()
            serve(ROOT / "src/ui", requested, out)
            self.assertTrue(out.getvalue().startswith(b"Status: 404"))

    def test_wasm_mime_supported(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "decoder.wasm"
            path.write_bytes(b"\x00asm")
            out = io.BytesIO()
            serve(temp, path, out)
            self.assertIn(b"application/wasm", out.getvalue())


