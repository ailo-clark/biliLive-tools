#!/bin/sh
set -eu
REPLAY_PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$REPLAY_PACKAGE_DIR/deploy/manage.py" undo "$@"
