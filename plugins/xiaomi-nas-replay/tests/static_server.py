"""Local test adapter for the actual CGI handler; not installed on the NAS."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from static_cgi import serve

ROOT = Path(__file__).resolve().parents[1] / "src/ui"


class Output:
    def __init__(self, handler):
        self.handler = handler
        self.header = bytearray()
        self.started = False

    def write(self, data):
        if not self.started:
            self.header.extend(data)
            if b"\r\n\r\n" not in self.header:
                return
            headers, body = bytes(self.header).split(b"\r\n\r\n", 1)
            lines = headers.decode().split("\r\n")
            status = int(lines[0].split()[1]) if lines[0].startswith("Status:") else 200
            self.handler.send_response(status)
            for line in lines:
                key, value = line.split(":", 1)
                if key != "Status":
                    self.handler.send_header(key, value.strip())
            self.handler.end_headers()
            self.started = True
            data = body
        if self.handler.command != "HEAD":
            self.handler.wfile.write(data)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        pieces = path.split("/bililivereplay/", 1)
        if len(pieces) != 2:
            self.send_error(404)
            return
        serve(ROOT, ROOT / pieces[1], Output(self))

    do_HEAD = do_GET

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
