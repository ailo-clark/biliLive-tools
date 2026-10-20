import json
import os
from pathlib import Path
import shutil
import sys
import unittest
from unittest.mock import patch

import test_deploy as fixtures
import manage
from manage import CRON, UNIT, UNIT_LINK, UNIT_PATH, Manager, System


class Recovery(unittest.TestCase):
    setUp = fixtures.Deployment.setUp
    tearDown = fixtures.Deployment.tearDown
    install = fixtures.Deployment.install
    assert_original = fixtures.Deployment.assert_original

    def clear_plugin(self, state):
        shutil.rmtree(self.manager.path(state["home"]))
        for logical in state["owned"][1:3]:
            self.manager.path(logical).unlink()
        for logical in [state["list_path"], *state["shared_targets"]]:
            path = self.manager.path(logical)
            data = json.loads(path.read_text())
            (data if logical == state["list_path"] else data["ports"]).pop(manage.PLUGIN, None)
            path.write_text(json.dumps(data))

    def test_market_cleanup_is_repaired_repeatedly_and_preserves_other_plugins(self):
        state = self.install()
        other_cron = self.manager.path("/etc/cron.d/another-plugin")
        other_cron.write_text("# keep this scheduler\n")
        for _ in range(2):
            self.clear_plugin(state)
            path = self.manager.path(state["list_path"])
            data = json.loads(path.read_text())
            data["another-plugin"] = {"info": {"id": 17}, "keep": True}
            path.write_text(json.dumps(data))
            self.manager.restore()
            self.assertTrue((self.manager.path(state["home"]) / "src/ui/index.html").is_file())
            self.assertTrue(json.loads(path.read_text())["another-plugin"]["keep"])
            self.assertIn(manage.PLUGIN, json.loads(path.read_text()))
            self.assertEqual(self.manager.status()["auto_recovery"]["last_check"]["status"], "ok")
        self.manager.rollback()
        self.manager.restore()  # A previously queued cron invocation is harmless.
        self.assertFalse(self.manager.path(state["home"]).exists())
        self.assertFalse(self.manager.path(CRON).exists())
        self.assertTrue(json.loads(path.read_text())["another-plugin"]["keep"])
        self.assertEqual(other_cron.read_text(), "# keep this scheduler\n")

    def test_cron_and_boot_link_removed_before_registration_or_nginx(self):
        self.install()
        from manage import atomic
        seen = []
        def observe(path, *args, **kwargs):
            if str(Path(path).relative_to(self.root)) in ("data/plugin/u12345.list", "etc/config/plugin", "etc/nginx/conf.d/luci/plugincenter.conf"):
                self.assertEqual(self.manager.load()["status"], "rolling_back")
                self.assertFalse(self.manager.path(CRON).exists())
                self.assertFalse(os.path.lexists(self.manager.path(UNIT_LINK)))
                seen.append(path)
            return atomic(path, *args, **kwargs)
        with patch("manage.atomic", side_effect=observe):
            self.manager.rollback()
        self.assertTrue(seen)
        self.assert_original()

    def test_failed_rollback_keeps_scheduling_disabled_until_manual_retry(self):
        state = self.install()
        self.system.fail_test_once = True
        with self.assertRaises(RuntimeError):
            self.manager.rollback()
        self.assertFalse(self.manager.path(CRON).exists())
        self.assertFalse(os.path.lexists(self.manager.path(UNIT_LINK)))
        self.manager.restore()
        self.assertEqual(self.manager.load()["status"], "recovery_needed")
        self.assertFalse(self.manager.path(CRON).exists())
        self.manager.rollback()
        self.assert_original()

    def test_restore_and_cli_skip_a_held_deployment_lock(self):
        state = self.install()
        self.clear_plugin(state)
        with self.manager.lock(), patch.object(manage, "Manager", return_value=self.manager), \
                patch.object(sys, "argv", ["manage.py", "restore"]), patch("manage.os.geteuid", return_value=0):
            self.assertEqual(manage.main(), 0)
        self.assertFalse(self.manager.path(state["home"]).exists())
        with self.manager.lock():
            self.manager.restore()
        self.assertTrue(self.manager.path(state["home"]).exists())

    def test_scheduler_and_boot_files_are_restored_without_service_commands(self):
        state = self.install()
        self.manager.path(CRON).unlink()
        self.manager.path(UNIT_LINK).unlink()
        self.manager.path(UNIT_PATH).unlink()
        self.manager.restore()
        self.assertEqual(self.manager.path(CRON).read_text(), state["cron"])
        self.assertEqual(self.manager.path(UNIT_PATH).read_text(), state["unit"])
        self.assertEqual(self.manager.path(UNIT_LINK).resolve(), self.manager.path(UNIT_PATH))
        self.assertEqual(self.manager.path(CRON).stat().st_mode & 0o777, 0o644)
        self.assertIn("*/2 * * * * root /usr/bin/python3", state["cron"])
        self.manager.rollback()
        self.assert_original()

    def test_partial_cleanup_fills_missing_files_without_overwriting_local_files(self):
        state = self.install()
        home = self.manager.path(state["home"])
        (home / "src/ui/index.html").unlink()
        shutil.rmtree(home / "src/ui/assets")
        local = home / "local-note.txt"
        local.write_text("keep local content")
        self.manager.restore()
        self.assertTrue((home / "src/ui/index.html").is_file())
        self.assertTrue(any((home / "src/ui/assets").glob("*.js")))
        self.assertEqual(local.read_text(), "keep local content")

    def test_restore_leaves_modified_runtime_status_alone(self):
        state = self.install()
        path = self.manager.path(state["list_path"])
        data = json.loads(path.read_text())
        data[manage.PLUGIN].update(status="stopped", changetime=123)
        path.write_text(json.dumps(data))
        before = path.read_bytes()
        self.manager.restore()
        self.assertEqual(path.read_bytes(), before)

    def test_modified_boot_link_and_symlink_icon_are_not_followed(self):
        state = self.install()
        link = self.manager.path(UNIT_LINK)
        link.unlink()
        link.symlink_to("../another.service")
        with self.assertRaisesRegex(RuntimeError, "开机恢复链接"):
            self.manager.restore()
        with self.assertRaisesRegex(RuntimeError, "开机恢复链接"):
            self.manager.rollback()
        link.unlink()
        link.symlink_to(f"../{UNIT}")
        icon = self.manager.path(state["owned"][2])
        icon.unlink()
        outside = self.root / "outside.png"
        outside.write_bytes(b"keep")
        icon.symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, "图标路径被占用"):
            self.manager.restore()
        self.assertEqual(outside.read_bytes(), b"keep")

    def test_install_restore_and_rollback_never_invoke_systemctl(self):
        commands = []
        class PtySystem(System):
            def run(self, args, ok=(0,)):
                from types import SimpleNamespace
                commands.append(args)
                if args[0] != "nginx":
                    raise AssertionError(f"PTY unsafe command: {args}")
                return SimpleNamespace(stdout="plugincenter.conf $need_reject", stderr="", returncode=0)

            def preflight(self, upstream):
                super().preflight(upstream, no_probe=True)
        self.manager.system = PtySystem()
        with patch("manage.shutil.which", return_value="/fake/bin"):
            state = self.install()
            self.clear_plugin(state)
            self.manager.restore()
            self.manager.rollback()
        self.assertTrue(commands)
        self.assert_original()

    def test_modified_scheduler_is_preserved_and_stops_restore_and_rollback(self):
        state = self.install()
        cron = self.manager.path(CRON)
        edited = cron.read_text() + "# user change\n"
        cron.write_text(edited)
        self.clear_plugin(state)
        with self.assertRaisesRegex(RuntimeError, "自动恢复配置已被修改"):
            self.manager.restore()
        with self.assertRaisesRegex(RuntimeError, "自动恢复配置已被修改"):
            self.manager.rollback()
        self.assertEqual(cron.read_text(), edited)
        self.assertFalse(self.manager.path(state["home"]).exists())
        self.assertEqual(self.manager.status()["auto_recovery"]["last_check"]["status"], "error")

    def test_numeric_id_conflict_stops_before_recreating_any_plugin_files(self):
        state = self.install()
        self.clear_plugin(state)
        path = self.manager.path(state["list_path"])
        data = json.loads(path.read_text())
        data["other"] = {"info": {"id": 109}}
        path.write_text(json.dumps(data))
        before = path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "109 已被其他插件占用"):
            self.manager.restore()
        self.assertEqual(path.read_bytes(), before)
        self.assertFalse(self.manager.path(state["home"]).exists())

    def test_external_change_during_restore_is_preserved_then_retried(self):
        state = self.install()
        self.clear_plugin(state)
        snapshot = self.manager.snapshot
        target = self.manager.path(state["list_path"])
        count = 0
        def changing_snapshot(path):
            nonlocal count
            if path == target:
                count += 1
                if count == 2:
                    data = json.loads(target.read_text())
                    data["new-plugin"] = {"keep": True}
                    target.write_text(json.dumps(data))
            return snapshot(path)
        with patch.object(self.manager, "snapshot", side_effect=changing_snapshot):
            with self.assertRaisesRegex(RuntimeError, "恢复过程中发生变化"):
                self.manager.restore()
        self.assertTrue(json.loads(target.read_text())["new-plugin"]["keep"])
        self.manager.restore()
        self.assertIn(manage.PLUGIN, json.loads(target.read_text()))
        self.assertTrue(json.loads(target.read_text())["new-plugin"]["keep"])

    def test_existing_cron_or_boot_link_is_not_overwritten(self):
        cron = self.manager.path(CRON)
        cron.write_text("# another owner\n")
        with self.assertRaisesRegex(RuntimeError, "目标已存在"):
            self.install()
        self.assertEqual(cron.read_text(), "# another owner\n")
        self.assertFalse(self.manager.base.exists())

    def test_legacy_journal_rollback_removes_only_its_owned_boot_link(self):
        state = self.install()
        self.manager.path(CRON).unlink()
        state.pop("cron")
        state["schema"] = 1
        state["owned"] = state["owned"][:4]
        state["changed"] = [p for p in state["changed"] if p not in (CRON, UNIT_LINK)]
        self.manager.save(state)
        # v0.1.0 systemctl enable may use an absolute link target.
        self.manager.path(UNIT_LINK).unlink()
        self.manager.path(UNIT_LINK).symlink_to(UNIT_PATH)
        self.manager.rollback()
        self.assert_original()

    def test_missing_cron_directory_stops_before_any_changes(self):
        self.manager.path("/etc/cron.d").rmdir()
        with self.assertRaisesRegex(RuntimeError, "/etc/cron.d"):
            self.install()
        self.assertFalse(self.manager.base.exists())

    def test_other_plugin_edit_during_rollback_is_not_overwritten(self):
        state = self.install()
        from manage import atomic
        target = self.manager.path(manage.SHARED[1])
        def write_and_edit(path, *args, **kwargs):
            result = atomic(path, *args, **kwargs)
            if Path(path) == self.manager.path(manage.SHARED[0]):
                data = json.loads(target.read_text())
                data["another-plugin-edited"] = True
                target.write_text(json.dumps(data))
            return result
        with patch("manage.atomic", side_effect=write_and_edit):
            with self.assertRaisesRegex(RuntimeError, "回滚过程中发生变化"):
                self.manager.rollback()
        self.assertTrue(json.loads(target.read_text())["another-plugin-edited"])
        self.assertEqual(self.manager.load()["status"], "recovery_needed")
        self.assertFalse(self.manager.path(CRON).exists())
        self.manager.rollback()
        self.assertTrue(json.loads(target.read_text())["another-plugin-edited"])
        self.assertNotIn(manage.PLUGIN, json.loads(target.read_text())["ports"])

    def test_rollback_failure_does_not_undo_another_plugins_later_edit(self):
        state = self.install()
        target = self.manager.path(manage.SHARED[0])
        def edited_test_failure():
            data = json.loads(target.read_text())
            data["later-edit"] = True
            target.write_text(json.dumps(data))
            raise RuntimeError("simulated late validation failure")
        with patch.object(self.system, "nginx_test", side_effect=edited_test_failure):
            with self.assertRaisesRegex(RuntimeError, "late validation"):
                self.manager.rollback()
        self.assertTrue(json.loads(target.read_text())["later-edit"])
        self.manager.rollback()
        self.assertTrue(json.loads(target.read_text())["later-edit"])
