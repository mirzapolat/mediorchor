#!/bin/sh
# Regenerate /config.js from the container environment at start-up. This lets a
# single prebuilt image be reconfigured per-deployment without rebuilding.
set -e

CONFIG_PATH="${CONFIG_PATH:-/usr/share/nginx/html/config.js}"

cat > "$CONFIG_PATH" <<EOF
window.__APP_CONFIG__ = {
  VITE_SUPABASE_URL: "${VITE_SUPABASE_URL:-}",
  VITE_SUPABASE_ANON_KEY: "${VITE_SUPABASE_ANON_KEY:-}",
  VITE_DEFAULT_LANGUAGE: "${VITE_DEFAULT_LANGUAGE:-en}",
  VITE_APP_NAME: "${VITE_APP_NAME:-Anwesenheit}",
  VITE_ACCENT_COLOR: "${VITE_ACCENT_COLOR:-#efa100}"
};
EOF

echo "Wrote runtime config to $CONFIG_PATH"
