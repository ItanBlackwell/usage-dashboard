# Changelog

## 0.13.0 (unreleased)

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
