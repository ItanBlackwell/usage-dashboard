# Changelog

## 0.13.0 (unreleased)

- Expand Billing browser detection to 26 Chromium browser variants, including
  Brave, Opera GX, Opera, Vivaldi, Chromium and preview channels. Prefer the
  current Windows default HTTPS browser for new sessions, offer detected
  alternatives and preserve the selected browser of confirmed sessions.
  Nonstandard Chromium derivatives are experimental.

- Separate ordinary-browser authorization from headless Billing reads. Require
  manual login, closure of the dedicated login profile and explicit confirmation
  of an allowlisted Billing URL. Do not automate OAuth or security verification.

- Isolate Billing commands in a versioned IPC contract, acknowledge commands
  before launching the browser, and report transport-stage error codes.

- Remove the browser companion and local HTTP balance receiver. Use only direct
  provider APIs and account-scoped Billing Sessions. Clean obsolete installed
  files and discard unbound cached balances on upgrade.

- Report Billing action failures explicitly, retry incomplete account inventory,
  retain safe UI diagnostics across popup lifetimes and constrain Billing
  buttons to compact 18-pixel controls.

- Fix Billing runtime installation on Windows PowerShell 5.1 by using a flat
  runtime pin validated against the npm lockfile during packaging.

- Add extension-free, account-scoped Billing Session for OpenAI API and OpenCode
  Zen with manual login, background refresh, reconnection and profile removal.
- Prepare an integrity-pinned Playwright Core runtime in Portable installation.

- Preserve confirmed account metrics during temporary plugin IPC fallback and
  incomplete credential inventory responses. Show safe balance error reasons.

- Correct missing USD symbol in the generated bundle and support the current
  OpenCode Console billing route.

- Preserve confirmed API balances, including zero, during temporary request failures.

- Show connected OpenCode pay-as-you-go and OpenCode Go accounts; retrieve Go
  quota windows from the official usage API, without guessing missing balances.

- Release the project as open source under the Mozilla Public License 2.0.
- Document installation, GUI layout support, Billing Session and security reporting.
- Add issue templates, contributor guidance and code of conduct.
- Split PR/commit validation from tag-triggered release publication.
- Add CI static checks and Windows installer/uninstaller smoke checks.
- Remove unused Setup.exe packaging.

## 0.12.0

- Initial Usage Dashboard distribution with account indicators, quota monitoring,
  account switching, persistent cache and Windows Portable packaging.

- License changed to Mozilla Public License 2.0 (MPL-2.0).
