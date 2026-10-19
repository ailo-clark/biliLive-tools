#!/bin/sh
set -eu
TASK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$TASK_DIR/manage.py" restore "$@"
