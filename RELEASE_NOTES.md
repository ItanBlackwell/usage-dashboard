# Usage Dashboard 0.13.0

Public-release preparation for Usage Dashboard. This release is **not published** until a maintainer explicitly creates and pushes the matching Git tag.

## Features
- Monitor OpenAI/Codex, Claude, DeepSeek, Kimi/Moonshot, Kimi Coding,
  OpenRouter, Z.AI/GLM, MiniMax, Gemini and Qwen connections when supported.
- Compact sidebar rings, live account overview, quota refresh, and latest-wins
  switching between saved accounts.
- Persistent cache and optional per-account Billing Sessions for OpenAI API
  and OpenCode Zen using Edge or Chrome, without a browser extension.
  The previous browser companion and its local HTTP receiver are removed.

## Installation (Windows)
1. Download `Usage-Dashboard-Portable-0.13.0.zip` from Releases.
2. Extract the ZIP, completely close OpenCode Desktop and run `Install.cmd`.
3. Reopen OpenCode and select **Side tabs** or **Inbox** under Interface layout.

See [Installation](docs/INSTALLATION.md) and [Billing Session](docs/BILLING_SESSION.md).
Sign in and confirm the matching account manually before background balance reads.

## Improvements
- Public-facing documentation, support guidelines and updated open-source license.
- Separate continuous integration from tag-triggered releases.
- Add syntax, packaging and clean Windows installation smoke checks in CI.
- Remove obsolete Setup.exe packaging.

**Known limitations:** OpenAI Codex quota details require legacy Codex login.
The OpenCode GUI SDK and sidebar DOM integration are experimental. API availability
varies by provider. No metrics should be interpreted as zero merely because they
are unavailable.

The archives contain no production credentials or cached usage data.

---
Copyright (c) 2026 ItanBlackwell.
