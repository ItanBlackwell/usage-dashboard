# Usage Dashboard 0.14.1

## What's new

- **Per-account Codex usage estimates:** observed 5-hour and weekly quota consumption for each connected OpenAI subscription, with daily and monthly UTC totals. Missing observations are shown as a dash.
- **Seven-day line charts:** select an account or provider without switching active credentials. View daily quota consumption or local model cost, with hover and keyboard details, gaps for unknown values, and a dashed segment for the current day.
- **Roomier popup:** approximately 15% larger width and maximum height (354 × 598 px, subject to viewport constraints), refined spacing and native theme colors.
- **Footer:** package version, copyright and a link to the GitHub repository.
- **Compact history:** retain up to seven days of observed Codex quota aggregates and reuse the existing local host statistics API for cost history. No additional external provider requests or dependencies.

## Installation (Windows)

1. Download `Usage-Dashboard-Portable-0.14.1.zip` and extract it.
2. Completely close OpenCode Desktop and run `Install.cmd`.
3. Restart OpenCode Desktop.

The Source ZIP and SHA-256 checksums are also available. See the [installation guide](https://github.com/ItanBlackwell/usage-dashboard/blob/main/docs/INSTALLATION.md) and [provider metrics](https://github.com/ItanBlackwell/usage-dashboard/blob/main/docs/PROVIDER_METRICS.md).

## Known limitations

Codex quota estimates are based on observed account-wide changes, may include activity outside OpenCode, and cannot reconstruct missing historical consumption. Local model costs are not confirmed provider charges and are aggregated by provider, not individual API keys. Codex quota access still requires legacy Codex browser or device-code authorization. The experimental OpenCode GUI SDK and layout adapters remain subject to host changes.

Copyright (c) 2026 ItanBlackwell. MPL-2.0.
