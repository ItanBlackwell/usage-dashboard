# Changelog

## 0.13.0 (unreleased)

- Report Billing action failures explicitly, retry incomplete account inventory,
  retain safe UI diagnostics across popup lifetimes and constrain Billing
  buttons to compact 18-pixel controls.

- Fix Billing runtime installation on Windows PowerShell 5.1 by using a flat
  runtime pin validated against the npm lockfile during packaging.

- Add extension-free, account-scoped Billing Session for OpenAI API and OpenCode
  Zen with manual login, background refresh, reconnection and profile removal.
- Prepare an integrity-pinned Playwright Core runtime in Portable installation;
  retain the browser extension as an explicitly optional legacy fallback.

- Preserve confirmed account metrics during temporary plugin IPC fallback and
  incomplete credential inventory responses. Show safe balance error reasons.

- Prepare optional Billing companion setup from Install.cmd, preferring Edge
  over Chrome, copying the installed path, and guiding manual browser approval.
  Preserve pairing on upgrades and support non-interactive installations.

- Correct missing USD symbol in the generated bundle, support the current
  OpenCode Console billing route, and show browser companion delivery status.

- Preserve confirmed API balances, including zero, during temporary request failures.
- Extend the optional browser billing companion to OpenCode Zen and explain
  unavailable or last-known balances without treating missing data as zero.

- Show connected OpenCode pay-as-you-go and OpenCode Go accounts; retrieve Go
  quota windows from the official usage API, without guessing missing balances.

- Release the project as open source under the Mozilla Public License 2.0.
- Document installation, GUI layout support, browser extension and security reporting.
- Add issue templates, contributor guidance and code of conduct.
- Split PR/commit validation from tag-triggered release publication.
- Add CI static checks and Windows installer/uninstaller smoke checks.
- Remove unused Setup.exe packaging.

## 0.12.0

- Initial Usage Dashboard distribution with account indicators, quota monitoring,
  account switching, persistent cache and Windows Portable packaging.

- License changed to Mozilla Public License 2.0 (MPL-2.0).
