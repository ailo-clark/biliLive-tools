import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import test_deploy as fixtures
from manage import verify_package

spec = importlib.util.spec_from_file_location("replay_pack", fixtures.ROOT / "scripts/pack.py")
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


class ReleaseArchive(unittest.TestCase):
    def test_downloadable_zip_contains_compiled_frontend_and_verified_recovery_scripts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            shutil.copytree(fixtures.ROOT, source)
            with patch.object(pack, "ROOT", source):
                archive = pack.package(root / "release")
            with zipfile.ZipFile(archive) as bundle:
                self.assertIsNone(bundle.testzip())
                names = bundle.namelist()
                self.assertTrue(any("/src/ui/assets/" in name and name.endswith(".js") for name in names))
                self.assertFalse(any(name.endswith(("/bridge.js", "/shell.js")) for name in names))
                self.assertTrue(any(name.endswith("/部署手册.md") for name in names))
                entry = bundle.getinfo("bililivereplay-0.1.0/install.sh")
                self.assertEqual((entry.external_attr >> 16) & 0o777, 0o755)
                bundle.extractall(root / "extracted")
            extracted = root / "extracted/bililivereplay-0.1.0"
            verify_package(extracted)
            fixture = fixtures.Deployment("runTest")
            fixture.setUp()
            try:
                state = fixture.manager.install(fixture.uid, "http://127.0.0.1:3000", extracted)
                self.assertEqual(state["status"], "installed")
                again = fixture.manager.deploy(fixture.uid, "http://127.0.0.1:3000", extracted)
                self.assertEqual(again["backup_id"], state["backup_id"])
                self.assertNotIn("previous_package", again)
                fixture.manager.undo()
                fixture.assert_original()
            finally:
                fixture.tearDown()
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            self.assertIn(digest, (root / "release/SHA256SUMS.txt").read_text())
