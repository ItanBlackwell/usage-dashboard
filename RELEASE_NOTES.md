# Usage Dashboard 0.14.0

## What's new

- **Top tabs support:** an experimental floating lower-left indicator with 16 px edge spacing. Side tabs and Inbox retain the native sidebar placement and updater alignment.
- **OpenCode accounts:** connected Zen/pay-as-you-go and Go accounts are now shown. Go uses the official usage endpoint for 5-hour, weekly and monthly quotas. Experimental Console budget and prepaid-credit reads reuse existing credentials and respect permissions.
- **Compact financial overview:** wallet balances and quota bars take priority; spending, tokens, model counters, budget policies and diagnostics are available in collapsed disclosures. Unknown balances appear as a dash, not zero.
- **Local usage estimates:** provider-level recorded usage for today and the current UTC month when provider metrics are missing. These estimates are not confirmed charges or per-account balances.
- **Expanded provider metrics:** OpenRouter effective budgets and free-model counters; DeepSeek and Moonshot balance breakdowns; permission-dependent Claude analytics, Kimi Code and MiniMax quotas, and isolated experimental Z.AI metrics.
- **Reliability:** exact local quota reset time on hover, corrected currency rendering, and preservation of confirmed balances and metrics during temporary provider or IPC failures.
- **Simpler installation:** retired browser-based billing, companion extension, local HTTP receiver and browser runtime dependencies. Upgrades clean known obsolete installed files while preserving private profiles.

## Installation (Windows)

1. Download `Usage-Dashboard-Portable-0.14.0.zip` and extract it.
2. Completely close OpenCode Desktop and run `Install.cmd`.
3. Restart OpenCode and choose Side tabs, Inbox or Top tabs.

See the [installation guide](https://github.com/ItanBlackwell/usage-dashboard/blob/main/docs/INSTALLATION.md) and [provider metrics](https://github.com/ItanBlackwell/usage-dashboard/blob/main/docs/PROVIDER_METRICS.md).

## Known limitations

OpenAI/Codex subscription quotas require legacy Codex browser or device-code authorization. OpenAI API prepaid credits are not exposed by a supported public endpoint. Metrics depend on provider permissions and available APIs. The OpenCode GUI SDK and layout adapters are experimental.

Copyright (c) 2026 ItanBlackwell. MPL-2.0.
