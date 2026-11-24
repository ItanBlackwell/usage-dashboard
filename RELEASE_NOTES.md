# Usage Dashboard 0.13.0

Public-release preparation for Usage Dashboard. This release is **not published** until a maintainer explicitly creates and pushes the matching Git tag.

## Features
- Monitor OpenAI/Codex, Claude, DeepSeek, Kimi/Moonshot, Kimi Coding,
  OpenRouter, Z.AI/GLM, MiniMax, Gemini and Qwen connections when supported.
- Compact sidebar rings, live account overview, quota refresh, and latest-wins
  switching between saved accounts.
- Persistent cache and direct OpenCode Console budget/credit reads using the
  existing connected account, with no browser sessions or additional keys.
  Console endpoints are experimental and access depends on provider permissions.
- Separate prepaid balance and policy budgets, including budget reset times.
  Remove browser-based financial data acquisition and runtime dependencies.

- Extended provider metrics for DeepSeek, Moonshot, OpenRouter, Claude,
  Kimi Code, MiniMax and Z.AI, with visible availability explanations.
  Experimental or permission-dependent data is explicitly labeled.
  See [provider metrics](docs/PROVIDER_METRICS.md).

## Installation (Windows)
1. Download `Usage-Dashboard-Portable-0.13.0.zip` from Releases.
2. Extract the ZIP, completely close OpenCode Desktop and run `Install.cmd`.
3. Reopen OpenCode and select **Side tabs** or **Inbox** under Interface layout.

See [Installation](docs/INSTALLATION.md) and [OpenCode budgets](docs/OPENCODE_BUDGETS.md).
Restart OpenCode after installation. The existing provider connections are
queried automatically; missing or forbidden metrics remain unavailable.

## Improvements
- Public-facing documentation, support guidelines and updated open-source license.
- Separate continuous integration from tag-triggered releases.
- Add syntax, packaging and clean Windows installation smoke checks in CI.
- Remove obsolete Setup.exe packaging.

**Known limitations:** OpenAI Codex quota details require legacy Codex login.
OpenAI API prepaid credits cannot be read through a supported public endpoint;
organization Costs API remains available. The OpenCode GUI SDK and sidebar DOM
integration are experimental. API availability
varies by provider. No metrics should be interpreted as zero merely because they
are unavailable.

The archives contain no production credentials or cached usage data.

---
Copyright (c) 2026 ItanBlackwell.
