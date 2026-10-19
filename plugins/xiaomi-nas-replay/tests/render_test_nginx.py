from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "deploy"))
from nginx import render
root = Path(sys.argv[1]).resolve()
web = Path(sys.argv[2]).resolve()
root.mkdir(parents=True, exist_ok=True)
(root / "logs").mkdir(exist_ok=True)
(root / "nginx.conf").write_text(f"""
pid {root}/nginx.pid;
error_log {root}/nginx.log info;
events {{ worker_connections 128; }}
http {{
  types {{
    text/html html; text/css css; application/javascript js;
    image/png png; image/jpeg jpg jpeg; image/svg+xml svg;
    font/woff2 woff2; font/woff woff; application/wasm wasm;
  }}
  access_log off;
  client_body_temp_path {root}/client-body;
  proxy_temp_path {root}/proxy;
  fastcgi_temp_path {root}/fastcgi;
  uwsgi_temp_path {root}/uwsgi;
  scgi_temp_path {root}/scgi;
  map $cookie_nas_test $need_reject {{ default 1; local-auth 0; }}
  log_format origin_log '$request_uri';
  server {{
    listen 127.0.0.1:18042;
    access_log {root}/docker-origin.log origin_log;
    location /api/ {{
      rewrite ^/api/(.*)$ /$1 break;
      proxy_pass http://127.0.0.1:18041;
      proxy_buffering off;
    }}
    location / {{
      root {web};
      return 404; # The dedicated plugin must never fetch Docker HTML or JavaScript.
    }}
  }}
  server {{
    listen 127.0.0.1:18043;
    {render("12345", "http://127.0.0.1:18042")}
    location /plugin/ {{
      if ($need_reject) {{ return 403; }}
      proxy_pass http://127.0.0.1:18044;
    }}
    # A realistic NAS may already have its own /api. It must remain untouched.
    location /api/ {{ return 418; }}
  }}
}}
""")
