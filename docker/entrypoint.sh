#!/bin/sh
# The data directory is usually a bind mount created by Docker as root. Hand it
# to the unprivileged `node` user, then drop privileges and start the server.
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node "$@"
fi

exec "$@"
