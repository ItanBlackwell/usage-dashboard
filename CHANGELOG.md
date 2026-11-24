# Changelog

## 0.13.0 (unreleased)

- Surface provider spending, usage and request counters without expanding
  account details; preserve sub-cent costs. Show separate provider-level local
  OpenCode estimates for today and the current UTC month when a balance,
  budget or quota is unavailable. Never attribute local statistics to individual
  credentials or treat model cost as a confirmed debit. Use the host statistics
  API without collecting chat content or creating another usage ledger.

- Read OpenRouter's applicable and effective budget policies, including shared
  workspace and guardrail caps, and the daily free-model counter from the
  existing key. Distinguish missing budget metadata from no configured budgets.
  Keep wallet access separate and invalidate budget counters after reset.

- Expand DeepSeek and Moonshot balance breakdowns and OpenRouter key spending,
  BYOK, cap/reset and expiration metrics using existing credentials.
- Add permission-aware Claude organization analytics (documented beta),
  additional Kimi Code quota/Extra Usage parsing, MiniMax per-model quota
  windows, and isolated experimental Z.AI model/tool/credit grant reads.
- Display unsupported, denied, missing and failed metrics directly in compact
  account cards, with expandable detail rows. Keep monetary balances distinct
  from spending caps and reject malformed or unavailable counters.

- Read OpenCode Console budget policies and prepaid credit balances directly
  with existing provider credentials, independently handling permissions.
  Show separate budget scope, remaining allowance and reset times; do not sum
  overlapping limits or treat invoiced credit as prepaid money.
- Remove browser-based financial data acquisition, including Billing Session,
  the browser companion, Playwright dependency, native window helper, command
  IPC, browser cache fields and obsolete controls. Clean known installed
  runtime files during upgrade without deleting private user profiles.
- Restore dependency-free Portable and Source packaging; validate API parsing,
  account isolation, cache sanitation and Windows installation migration.

- Preserve confirmed account metrics during temporary plugin IPC fallback and
  incomplete credential inventory responses. Show safe balance error reasons.

- Correct missing USD symbol in the generated bundle.

- Preserve confirmed API balances, including zero, during temporary request failures.

- Show connected OpenCode pay-as-you-go and OpenCode Go accounts; retrieve Go
  quota windows from the official usage API, without guessing missing balances.

- Release the project as open source under the Mozilla Public License 2.0.
- Document installation, GUI layout support, OpenCode budget metrics and security reporting.
- Add issue templates, contributor guidance and code of conduct.
- Split PR/commit validation from tag-triggered release publication.
- Add CI static checks and Windows installer/uninstaller smoke checks.
- Remove unused Setup.exe packaging.

## 0.12.0

- Initial Usage Dashboard distribution with account indicators, quota monitoring,
  account switching, persistent cache and Windows Portable packaging.

- License changed to Mozilla Public License 2.0 (MPL-2.0).
