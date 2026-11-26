# Usage Dashboard 0.14.2

## What's new

- **Plugin updates:** Windows portable installations can check stable GitHub releases at startup and every 24 hours. Choose notifications (default), automatic installation, or manual checks in the popup footer.
- **Update integrity:** bounded downloads, SHA-256 verification, allowlisted package files, backup and rollback on replacement errors. Settings and usage history are preserved. Restart OpenCode to activate an installed update.
- **Weekly quota estimates:** account for reset timestamp drift and the first positive reading after an observed unused weekly quota. Keep ambiguous intervals and unobserved history out of consumption estimates.
- **Weekly charts:** display only available quota series, retain recent observed history, and explain empty charts without inventing consumption.

## Installation and upgrade (Windows)

1. Download `Usage-Dashboard-Portable-0.14.2.zip` and extract it.
2. Completely close OpenCode Desktop and run `Install.cmd`.
3. Restart OpenCode Desktop.

Existing installations without an updater require this manual upgrade. The Source ZIP and SHA-256 checksums are also available. See the [installation guide](https://github.com/ItanBlackwell/usage-dashboard/blob/main/docs/INSTALLATION.md).

## Known limitations

The updater is intended for standard Windows portable installations. SHA-256 checksums are not independent code signatures. An interrupted replacement may require reinstalling a trusted portable ZIP. Live Desktop update behavior is not established by CI alone. Codex quota estimates remain observational and cannot reconstruct unobserved history; quota access still requires legacy authorization. The experimental OpenCode GUI SDK remains subject to host changes.

Copyright (c) 2026 ItanBlackwell. MPL-2.0.
