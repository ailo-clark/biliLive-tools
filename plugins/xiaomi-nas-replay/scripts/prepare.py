#!/usr/bin/env python3
"""Copy this revision's dedicated build into the distributable plugin layout."""
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
SOURCE = REPO / "packages/app/out/nas-replay"
if not (SOURCE / "index.html").is_file():
    raise SystemExit("先执行 pnpm --filter biliLive-tools build:nas-replay")
target = ROOT / "src/ui"
for name in ("index.html", "assets"):
    destination = target / name
    if destination.is_dir():
        shutil.rmtree(destination)
    elif destination.exists():
        destination.unlink()
    if (SOURCE / name).is_dir():
        shutil.copytree(SOURCE / name, destination)
    else:
        shutil.copy2(SOURCE / name, destination)
revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
(ROOT / "BUILD.json").write_text(json.dumps({
    "pluginVersion": json.loads((ROOT / "INFO").read_text())["version"], "mode": "standalone-replay-frontend",
    "sourceRevision": revision, "sharedPlayerAndProgress": True,
    "dockerWebProxy": False, "responseRewriting": False,
    "minimumBackend": "watch-calendar-20261015",
    "recommendedBackend": "watch-progress-fullscreen-r1",
}, ensure_ascii=False, indent=2) + "\n")
