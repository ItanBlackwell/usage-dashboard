# Usage Dashboard

[![Latest release](https://img.shields.io/github/v/release/ItanBlackwell/usage-dashboard?label=release)](https://github.com/ItanBlackwell/usage-dashboard/releases/latest)
[![CI](https://github.com/ItanBlackwell/usage-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/ItanBlackwell/usage-dashboard/actions/workflows/ci.yml)
[![License: MPL 2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
![Windows](https://img.shields.io/badge/platform-Windows-0078D4)

**Monitor AI-provider usage limits, API balances, and multiple accounts directly in OpenCode Desktop.**

Usage Dashboard is an **open-source** plugin for
**OpenCode Desktop**. It shows supported AI-provider quota windows, connected
accounts and balances where available, and provides quick account switching.
The OpenCode GUI SDK is experimental and its sidebar DOM can change across
Desktop versions.

> **License:** [Mozilla Public License 2.0](LICENSE) (`MPL-2.0`).
> You may use, modify, redistribute, and commercially use the software subject
> to the MPL 2.0 terms, including the source-sharing requirements for covered files.

## Preview

<p align="center">
  <img src="usage-dashboard-preview.png" alt="Usage Dashboard example showing quota cards and circular usage rings" width="50%" />
</p>

*Illustrative example with demonstration account data.*

## Installation (Windows)

1. Download **Usage-Dashboard-Portable-0.13.0.zip** from the [latest GitHub Release](https://github.com/ItanBlackwell/usage-dashboard/releases/latest).
2. Extract the ZIP and completely close OpenCode Desktop.
3. Run **`Install.cmd`** by double-clicking it, then restart OpenCode.
4. Go to **Settings → General → Interface layout** and choose **Side tabs** or **Inbox**.
5. Look for the circular Usage Dashboard indicator at the bottom of the left sidebar.

No separate Node.js, OpenCode CLI or manual PowerShell commands are required
for Portable installation. The script uses built-in Windows PowerShell.

**Important:** The icon is not displayed with **Top tabs**. If OpenCode lists
an installed plugin but no indicator appears, check the layout and restart.

See [Installation and troubleshooting](docs/INSTALLATION.md) for details.

### Enable OpenAI and OpenCode Zen API balances (without an extension)

The installer prepares the optional Billing Session runtime. Edge is preferred;
Chrome is used if Edge is not installed. No Developer mode or browser extension
is necessary. **Manual authorization is still required:**

1. Restart OpenCode and click **Connect Billing** on the OpenAI API or Zen API card.
2. In the separate browser window, sign in and select the matching organization
   or workspace. Open its Billing page.
3. Return to the popup and click **Confirm account** after verifying that the
   billing account owns the connected API key.

The plugin then attempts periodic background reads using that isolated session.
If login expires, reconnect manually. The experimental page reader may fail if
the provider changes its site. See [Billing Session setup](docs/BILLING_SESSION.md).
The [legacy browser companion](docs/BROWSER_EXTENSION.md) remains optional.

## Compatibility and limits

- **OpenAI/Codex subscription quotas** (5-hour and weekly) require
  **Codex browser (legacy)** or **Codex device code (legacy)** authorization.
  The newer **Sign in with ChatGPT** flow does not expose the required quota
  data to this plugin.
- Supported account connections include OpenAI/Codex, Anthropic/Claude,
  DeepSeek, Moonshot/Kimi, Kimi Coding, OpenRouter, Z.AI/GLM, MiniMax,
  Google Gemini, Alibaba Qwen, OpenCode (pay-as-you-go / Zen) and OpenCode Go.
  Actual quota/balance availability depends on the account type, provider API
  and authorization method.
- OpenCode Go uses the [official usage endpoint](https://opencode.ai/docs/console/go/#usage)
  for 5-hour, weekly and monthly limits. Connected OpenCode pay-as-you-go
  accounts are displayed even when their credit balance is unavailable; Billing Session
  can read a visible workspace credit balance.
- Confirmed zero balances are displayed with two decimal places and currency.
- Missing data is shown as unavailable, never assumed to mean a zero balance.
  Temporary provider errors preserve the last confirmed API balance.
- The experimental OpenCode GUI SDK may change without backward compatibility.

## Features

- Sidebar icon with colored quota rings and a compact account popup.
- Five-hour and weekly quota windows, when the provider exposes them.
- Serialized account switching: new selections replace pending unstarted
  requests, preventing stale updates from overriding the latest click.
- Cached, refreshed usage summaries. Account credentials stay in the host
  process and are never passed to the GUI or saved in the usage cache.
- Optional [Billing Session](docs/BILLING_SESSION.md) with separate per-account
  browser profiles for OpenAI and OpenCode Zen.


## Community and feedback

- [Report a bug](https://github.com/ItanBlackwell/usage-dashboard/issues/new/choose)
- [Suggest a feature](https://github.com/ItanBlackwell/usage-dashboard/issues/new/choose)
- [Browse releases](https://github.com/ItanBlackwell/usage-dashboard/releases)
- [Contributing guide](CONTRIBUTING.md)

## Development and contributions

Requirements for building from source: Node.js 22+, Python 3 and network access
for the integrity-checked Billing runtime archive.

```sh
node build.cjs
node --check dist/gui-experimental.cjs
python3 tools/make-distributions.py
```

No standalone test scripts are included in this repository; GitHub Actions
performs syntax, archive and Windows installer smoke checks. These checks do
not substitute for testing the live OpenCode Desktop GUI.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[OpenCode GUI SDK documentation](https://opencode.ai/docs/build/plugins/gui/).

## Privacy and acknowledgments

Usage Dashboard communicates with connected provider endpoints to obtain
available usage data; it is not an official product of OpenCode or the AI
providers it integrates with. The optional browser companion communicates with
a local loopback-only receiver (default port 18746) using a generated secret.
Do not share local `pairing.json`, tokens, isolated billing profiles or cached
private information.

Copyright (c) 2026 ItanBlackwell. Licensed under MPL-2.0.
See [LICENSE](LICENSE) and [NOTICE](NOTICE).
