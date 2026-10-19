#!/usr/bin/python3
"""Serve the bundled replay frontend through the NAS's existing authenticated CGI."""
import mimetypes
import os
from pathlib import Path
import sys


def serve(root, requested, output):
    if os.environ.get("REQUEST_METHOD", "GET") not in ("GET", "HEAD"):
        output.write(b"Status: 405 Method Not Allowed\r\nContent-Type: text/plain\r\n\r\nMethod not allowed")
        return
    root = Path(root).resolve()
    try:
        target = Path(requested).resolve(strict=True)
        target.relative_to(root)
        if not target.is_file() or target.suffix not in {".html", ".js", ".css", ".json", ".png", ".jpg", ".jpeg", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".wasm"}:
            raise ValueError("not a frontend asset")
    except (ValueError, OSError):
        output.write(b"Status: 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNot found")
        return
    mime = {".js": "application/javascript", ".wasm": "application/wasm"}.get(target.suffix) or mimetypes.guess_type(target)[0] or "application/octet-stream"
    cache = "private, max-age=86400" if "assets" in target.relative_to(root).parts else "no-cache"
    output.write(f"Content-Type: {mime}\r\nContent-Length: {target.stat().st_size}\r\nCache-Control: {cache}\r\nX-Content-Type-Options: nosniff\r\n\r\n".encode())
    if os.environ.get("REQUEST_METHOD", "GET") != "HEAD":
        with target.open("rb") as stream:
            while data := stream.read(64 * 1024):
                output.write(data)


if __name__ == "__main__":
    serve(Path(__file__).resolve().parent, os.environ.get("FILE_REQ", ""), sys.stdout.buffer)
