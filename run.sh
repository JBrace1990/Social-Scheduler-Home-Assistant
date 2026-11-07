#!/usr/bin/with-contenv bashio
set -euo pipefail

mkdir -p /data/assets /data/logs /data/bin
export DATABASE_PATH=/data/socialscheduler.db
export ASSET_STORAGE_DIR=/data/assets
export ASSET_PORT=8787
export DRY_RUN="$(bashio::config 'dry_run')"
export KILL_SWITCH="$(bashio::config 'kill_switch')"
export DEFAULT_TIMEZONE="$(bashio::config 'default_timezone')"
set_if_configured() {
  local config_key="$1" env_key="$2" value
  value="$(bashio::config "$config_key")"
  if [ -n "$value" ]; then
    export "$env_key=$value"
  fi
}
set_if_configured meta_app_id META_APP_ID
set_if_configured meta_app_secret META_APP_SECRET
export META_GRAPH_BASE="$(bashio::config 'meta_graph_base')"
export META_GRAPH_VERSION="$(bashio::config 'meta_graph_version')"
set_if_configured public_asset_base_url PUBLIC_ASSET_BASE_URL
set_if_configured tiktok_client_key TIKTOK_CLIENT_KEY
set_if_configured tiktok_client_secret TIKTOK_CLIENT_SECRET
export VIDEO_CONVERTER=ffmpeg

cd /app
if [ -f /share/socialscheduler-migration.tar ] && [ ! -f /data/.migration-imported ]; then
  bashio::log.info "Found /share/socialscheduler-migration.tar; importing Home Assistant share archive"
  cp /share/socialscheduler-migration.tar /data/socialscheduler-migration.tar
fi
if [ -f /data/socialscheduler-migration.tar ]; then
  python3 scripts/import_ha_data.py /data/socialscheduler-migration.tar
fi
if [ -f /data/source.env ]; then
  cp /data/source.env /app/.env
fi
python3 migrate.py

python3 -m worker.cloudflared_setup || bashio::log.warning "cloudflared setup failed; Meta-hosted media publishing may not work"
export CLOUDFLARED_PATH=/app/data/bin/cloudflared

cd /app/dashboard
npm start -- --hostname 127.0.0.1 --port 3000 &
dashboard_pid=$!
(
  cd /app
  exec python3 -m worker.run
) >> /data/logs/worker.log 2>&1 &
worker_pid=$!
trap 'kill "$worker_pid" "$dashboard_pid" 2>/dev/null || true; wait || true' EXIT INT TERM
nginx -g 'daemon off;'
