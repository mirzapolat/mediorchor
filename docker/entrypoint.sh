#!/bin/sh
set -e

# Inject runtime configuration, then hand off to nginx.
/docker-entrypoint.d/env.sh
exec nginx -g 'daemon off;'
