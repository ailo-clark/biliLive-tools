import json
import os
from pathlib import Path
import shutil
from unittest.mock import patch

import unittest
import test_deploy as fixtures
ROOT, SHARED = fixtures.ROOT, fixtures.SHARED
VERSION = json.loads((ROOT / "INFO").read_text())["version"]
NEXT_VERSION = "0.1.2"


class Upgrade(unittest.TestCase):
    setUp = fixtures.Deployment.setUp
    tearDown = fixtures.Deployment.tearDown
    install = fixtures.Deployment.install
    assert_original = fixtures.Deployment.assert_original
    def next_release(self):
        release = self.root / "new-package"
        shutil.copytree(ROOT, release)
        info = json.loads((release / "INFO").read_text())
        info["version"] = NEXT_VERSION
        (release / "INFO").write_text(json.dumps(info))
        manifest = release / "MANIFEST.json"
        manifest.unlink(missing_ok=True)
        with (release / "src/ui/index.html").open("a") as stream:
            stream.write("<!-- updated release -->")
        return release

    def test_upgrade_then_undo_restores_previous_frontend_and_preserves_data(self):
        old = self.install()
        release = self.next_release()
        state = self.manager.deploy(self.uid, old["upstream"], release)
        home = self.manager.path(state["home"])
        self.assertEqual(json.loads((home / "INFO").read_text())["version"], NEXT_VERSION)
        self.assertIn("updated release", (home / "src/ui/index.html").read_text())
        restored = self.manager.undo()
        self.assertEqual(restored["status"], "installed")
        self.assertEqual(json.loads((home / "INFO").read_text())["version"], VERSION)
        self.assertEqual((home / "src/ui/index.html").read_bytes(), (ROOT / "src/ui/index.html").read_bytes())
        self.assertTrue(self.manager.status()["auto_recovery"]["enabled"])
        self.assertEqual((self.manager.base / "runtime/manage.py").read_bytes(), (ROOT / "deploy/manage.py").read_bytes())
        self.manager.undo()  # Repeating rollback must not uninstall the restored version.
        self.assertTrue(home.exists())
        for logical in ("/original-data/app.db", "/original-data/watch-history.db", "/original-video/live.mp4"):
            self.assertEqual(self.manager.path(logical).read_bytes(), self.baseline[logical])
        self.manager.rollback()
        self.assert_original()

    def test_failed_upgrade_automatically_restores_working_previous_release(self):
        old = self.install()
        release = self.next_release()
        install = self.manager.install
        def fail_new(uid, upstream, package):
            if Path(package) == release:
                self.system.fail_reload_once = True
            return install(uid, upstream, package)
        with patch.object(self.manager, "install", side_effect=fail_new):
            with self.assertRaisesRegex(RuntimeError, "已自动恢复上一版"):
                self.manager.deploy(self.uid, old["upstream"], release)
        current = self.manager.load()
        self.assertEqual(current["status"], "installed")
        self.assertEqual(json.loads((self.manager.path(current["home"]) / "INFO").read_text())["version"], VERSION)
        self.manager.rollback()
        self.assert_original()

    def test_incomplete_upgrade_leaves_working_installation_untouched(self):
        old = self.install()
        before = {name: self.manager.path(name).read_bytes() for name in old["snapshots"]}
        release = self.next_release()
        (release / "src/ui/index.html").unlink()
        with self.assertRaisesRegex(RuntimeError, "升级包不完整"):
            self.manager.deploy(self.uid, old["upstream"], release)
        self.assertEqual(self.manager.load()["backup_id"], old["backup_id"])
        for name, data in before.items():
            self.assertEqual(self.manager.path(name).read_bytes(), data)

    def test_coexists_with_previous_proxy_plugin_on_same_docker_backend(self):
        list_path = "/data/plugin/u12345.list"
        data = json.loads(self.baseline[list_path])
        data["bililivewatch"] = {"info": {"id": 108}, "custom": "keep-proxy-plugin"}
        self.baseline[list_path] = json.dumps(data).encode()
        self.manager.path(list_path).write_bytes(self.baseline[list_path])
        data = json.loads(self.baseline[SHARED[0]])
        data["ports"]["bililivewatch"] = {"u12345": 3000}
        self.baseline[SHARED[0]] = json.dumps(data).encode()
        self.manager.path(SHARED[0]).write_bytes(self.baseline[SHARED[0]])
        self.install()
        self.assertIn("bililivewatch", json.loads(self.manager.path(list_path).read_text()))
        self.manager.undo()
        self.assert_original()

    def test_uid_detection_uses_existing_user_and_rejects_ambiguity(self):
        self.assertEqual(self.manager.detect_uid(), "12345")
        self.manager.path("/data/plugin/u67890.list").write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "无法唯一确定"):
            self.manager.detect_uid()

    def test_first_install_undo_is_repeatable_and_restores_baseline(self):
        self.install()
        self.manager.undo()
        self.manager.undo()
        self.assert_original()
