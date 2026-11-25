# Changelog

## 0.14.1

- Add a small version and copyright footer at the bottom of the usage popup,
  with a GitHub repository link, using package metadata embedded at build time.

- Increase the popup width and maximum height by approximately 15% while
  respecting viewport bounds; refine card spacing and the popup header.
- Add an interactive seven-day UTC line chart to **Usage estimate**, with
  independent account/provider selection, quota and local cost modes,
  visible gaps, confirmed zeros, a dashed current-day segment and per-day
  details. Retain at most seven days of Codex observations and refresh the
  six completed local usage days through the existing host statistics API.

- Rename the collapsed local usage section to **Usage estimate** and add
  observed Codex quota consumption per connected OpenAI subscription, with
  separate 5-hour and weekly totals for today and the current UTC month.
  Preserve provider-level local cost statistics and reuse existing quota
  refreshes. Persist only bounded aggregates and baselines; omit ambiguous
  intervals and show unavailable observations as a dash.

## 0.14.0

- Show the exact local quota reset time on hover.
- Increase Top tabs indicator edge spacing to 16 px.

- Add an experimental lower-left floating indicator for Top tabs, reusing the
  existing popup and switching automatically to the in-flow sidebar indicator
  for Side tabs and Inbox. Keep native updater alignment in sidebar layouts.

- Prioritize wallet balances and remaining quota bars in the compact view.
  Keep spending, usage counters, budget details and diagnostics in collapsed
  disclosures; preserve sub-cent costs. Use a dash without a redundant
  unavailable-balance caption. Show separate provider-level local
  OpenCode estimates in a collapsed section for today and the current UTC month when a balance,
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

## 0.13.0

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
