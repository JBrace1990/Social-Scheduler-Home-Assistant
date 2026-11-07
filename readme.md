# Social Scheduler for Home Assistant

This repository packages the SocialScheduler application as a Home Assistant add-on. It runs the Next.js dashboard and Python publishing worker together and stores the SQLite database and uploaded media in the add-on's persistent `/data` directory.

The checked-out application snapshot is based on the Windows/macOS project at [Liparoto/Social-Scheduler](https://github.com/Liparoto/Social-Scheduler), including the local code changes present when this Home Assistant port was created. The upstream checkout was left untouched. This new repository has its own Git history; it does not carry the source repository's commit ancestry because Windows Git rejected access to the source checkout metadata.

## Install

1. Push this repository to a Git host reachable by Home Assistant.
2. In Home Assistant, open **Settings → Apps → App store → ⋮ → Repositories** and add the repository URL.
3. Install **Social Scheduler**, review the app options, and start it.
4. Open the **Social Scheduler** item in the left sidebar. Home Assistant Ingress supplies the authenticated panel.

The option `dry_run` starts enabled. Leave it enabled until channels and credentials are configured and you have checked that the app behaves as expected. `kill_switch` is an immediate publishing stop when enabled.

## Publishing media

The add-on can publish platforms that accept media uploads directly. Instagram and Facebook require Meta to fetch locally stored media from a public URL. For these, configure `public_asset_base_url` with a reachable HTTPS media endpoint/tunnel arrangement supported by the app. Home Assistant Ingress is for the dashboard and is not a public media URL. Do not expose the dashboard port to the internet as a substitute.

## Data and logs

Home Assistant persists `/data/socialscheduler.db`, `/data/assets`, and `/data/logs` across add-on upgrades. Back up the Home Assistant system or the add-on data before moving the installation. The add-on options hold API credentials; configure them in the app options page.

## Development

The add-on manifest and Docker build are at the repository root, as required for a single-app repository. The original platform launch scripts remain in the source snapshot for Windows/macOS users. Add-on builds are intended for Home Assistant's supported architectures.

## Upstream

The application source is maintained at [Liparoto/Social-Scheduler](https://github.com/Liparoto/Social-Scheduler). This port is a separate working repository; updates from upstream should be reviewed and merged into this tree so the Home Assistant packaging remains intact.
