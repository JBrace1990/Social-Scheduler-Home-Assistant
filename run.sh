#!/usr/bin/with-contenv bashio
set -euo pipefail

mkdir -p /data/assets /data/logs /data/bin
export DATABASE_PATH=/data/socialscheduler.db
export ASSET_STORAGE_DIR=/data/assets
export ASSET_PORT=8787
export DRY_RUN="$(bashio::config 'dry_run')"
export KILL_SWITCH="$(bashio::config 'kill_switch')"
export DEFAULT_TIMEZONE="$(bashio::config 'default_timezone')"
export META_APP_ID="$(bashio::config 'meta_app_id')"
export META_APP_SECRET="$(bashio::config 'meta_app_secret')"
export META_GRAPH_BASE="$(bashio::config 'meta_graph_base')"
export META_GRAPH_VERSION="$(bashio::config 'meta_graph_version')"
export PUBLIC_ASSET_BASE_URL="$(bashio::config 'public_asset_base_url')"
export TIKTOK_CLIENT_KEY="$(bashio::config 'tiktok_client_key')"
export TIKTOK_CLIENT_SECRET="$(bashio::config 'tiktok_client_secret')"
export VIDEO_CONVERTER=ffmpeg

cd /app
python3 migrate.py

python3 -m worker.cloudflared_setup || bashio::log.warning "cloudflared setup failed; Meta-hosted media publishing may not work"
export CLOUDFLARED_PATH=/app/data/bin/cloudflared

python3 -m worker.run >> /data/logs/worker.log 2>&1 &
worker_pid=$!
trap 'kill "$worker_pid" 2>/dev/null || true' EXIT INT TERM
cd /app/dashboard
npm start -- --hostname 0.0.0.0 --port 3939
