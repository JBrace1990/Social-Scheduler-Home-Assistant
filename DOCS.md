# Social Scheduler add-on

The add-on runs the SocialScheduler dashboard and publisher worker in one container. Home Assistant Ingress is enabled and adds a Social Scheduler link in the Home Assistant sidebar. The app does not require a separate Home Assistant integration.

## First run

The add-on starts in dry-run mode. Configure API credentials under the add-on's Configuration tab, then restart it. Confirm channels and schedules in the dashboard before changing `dry_run` to `false`. Set `kill_switch` to `true` to stop publishing while leaving the dashboard available.

## Persistent data

SQLite and media files are stored under `/data`. They survive container rebuilds and upgrades. Keep regular Home Assistant backups.

## Meta media access

Instagram and Facebook publication of local media requires a public HTTPS URL so Meta can download the media. `public_asset_base_url` must name the configured public media endpoint. The dashboard's Home Assistant Ingress URL is private and cannot serve this purpose. Platforms where the app uploads media bytes directly do not need this public endpoint.

## Troubleshooting

Use the add-on **Log** tab for dashboard startup errors. Worker logs are written to `/data/logs/worker.log`; they remain available in the add-on data directory. Verify credentials and preserve `dry_run: true` while diagnosing publishing configuration.
