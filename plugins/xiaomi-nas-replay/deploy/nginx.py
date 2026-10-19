"""NAS-authenticated, same-origin API proxy. Static UI uses the native plugin CGI."""
import re
from urllib.parse import urlsplit

PLUGIN = "bililivereplay"


def validate_upstream(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment
            or parsed.username or parsed.password or not 1 <= parsed.port <= 65535):
        raise ValueError("upstream 必须是 http://127.0.0.1:端口，指向现有 fullstack 容器")
    return f"http://127.0.0.1:{parsed.port}", parsed.port


def markers(uid):
    return f"# BEGIN {PLUGIN} uid={uid}\n", f"# END {PLUGIN} uid={uid}\n"


def render(uid, upstream):
    if not re.fullmatch(r"[1-9][0-9]{0,19}", str(uid)):
        raise ValueError("UID 必须为不带 u 前缀的正整数")
    upstream, _ = validate_upstream(upstream)
    start, end = markers(uid)
    return start + f"""location ~ "^/plugin/u?{uid}/{PLUGIN}/api(?:/|$)" {{
    if ($need_reject) {{ return 403; }}
    rewrite ^/plugin/u?{uid}/{PLUGIN}/api(.*)$ /api$1 break;
    proxy_pass {upstream};
    proxy_http_version 1.1;
    proxy_set_header Host $proxy_host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Cookie "";
    proxy_set_header X-Forwarded-Proto https;
    set $bililivereplay_connection "";
    if ($http_upgrade != "") {{ set $bililivereplay_connection "upgrade"; }}
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $bililivereplay_connection;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_max_temp_file_size 0;
    proxy_connect_timeout 5s;
    proxy_read_timeout 3600s;
    client_max_body_size 0;
    access_log off;
    add_header Cache-Control "no-store" always;
}}
""" + end


def remove_block(content, uid, expected):
    start, end = markers(uid)
    if start not in content and end not in content:
        return content
    if content.count(start) != 1 or content.count(end) != 1 or content.count(expected) != 1:
        raise RuntimeError("插件 Nginx 配置被修改，已停止回滚；请先检查备份和当前配置")
    return content.replace(expected, "", 1)
