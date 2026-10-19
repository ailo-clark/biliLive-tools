"""Retain actionable failures in GitHub check annotations as well as job logs."""
import os
import subprocess
import sys

result = subprocess.run(sys.argv[1:], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
print(result.stdout, end="", flush=True)
if result.returncode and os.environ.get("GITHUB_ACTIONS") == "true":
    detail = result.stdout[-10000:].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error title=NAS replay validation failed::{detail}", flush=True)
sys.exit(result.returncode)
