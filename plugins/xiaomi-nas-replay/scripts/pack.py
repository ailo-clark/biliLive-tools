#!/usr/bin/env python3
"""Build a ready-to-install archive; never fetch or deploy anything."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def package(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    info = json.loads((ROOT / "INFO").read_text())
    name = f"bililivereplay-{info['version']}"
    required = ["install.sh", "rollback.sh", "INFO", "BUILD.json", "LICENSE", "README.md", "部署手册.md", "src/ui/index.html", "src/ui/config", "src/ui/icon.png", "deploy/manage.py", "deploy/nginx.py", "deploy/static_cgi.py", "scripts/control"]
    if not all((ROOT / path).is_file() for path in required) or not any((ROOT / "src/ui/assets").glob("*.js")):
        raise RuntimeError("缺少前端产物或部署文件，请先构建并运行 prepare.py")
    files = sorted(p for p in ROOT.rglob("*") if p.is_file() and not p.is_symlink()
                   and not {".git", "__pycache__", "tests", "dist"}.intersection(p.relative_to(ROOT).parts)
                   and p.suffix not in (".pyc", ".zip") and p.name not in {".gitignore", "MANIFEST.json"}
                   and output not in p.parents)
    info["size"] = sum(p.stat().st_size for p in files if p.relative_to(ROOT).parts[0] in ("src", "scripts"))
    (ROOT / "INFO").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n")
    manifest = {"format": 1, "plugin": "bililivereplay", "version": info["version"],
                "files": {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
    (ROOT / "MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    files.append(ROOT / "MANIFEST.json")
    archive = output / f"{name}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in files:
            item = zipfile.ZipInfo(name + "/" + path.relative_to(ROOT).as_posix(), (2026, 10, 19, 0, 0, 0))
            item.create_system = 3
            item.compress_type = zipfile.ZIP_DEFLATED
            mode = 0o755 if path.suffix == ".sh" or path.name == "control" else 0o644
            item.external_attr = (0o100000 | mode) << 16
            bundle.writestr(item, path.read_bytes(), compresslevel=9)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest() + "  " + archive.name + "\n"
    (output / "SHA256SUMS.txt").write_text(checksum)
    print(checksum, end="")
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    package(parser.parse_args().output)
