# Installation and troubleshooting (Windows)

## Portable installation

1. Download `Usage-Dashboard-Portable-<version>.zip` from
   [Releases](https://github.com/ItanBlackwell/usage-dashboard/releases).
2. Extract the archive **before** running anything. OpenCode may remain running.
3. Open the extracted `Usage-Dashboard` directory and double-click
   `Install.cmd`. Windows PowerShell is part of Windows; no separate Node.js or
   OpenCode CLI installation is needed.
4. Reopen OpenCode Desktop.
5. Under **Settings → General → Interface layout**, select **Side tabs**,
   **Inbox**, or **Top tabs**. The indicator lives in the lower-left corner,
   inside the sidebar when present.

The installer puts files into
`%USERPROFILE%\.config\opencode\plugins\usage-dashboard` by default,
or an absolute `OPENCODE_CONFIG_DIR` if you configured one. Do not add a second
plugin entry to `opencode.jsonc`: OpenCode automatically discovers the folder.

## Automatic updates (Windows)

The popup footer includes **Updates**. By default, the plugin checks stable GitHub releases at startup and every 24 hours and asks before installing. Choose **Automatic** to install new stable versions without confirmation, or **Manual** to disable scheduled checks. Restart OpenCode to activate installed updates. The updater checks the portable ZIP against SHA256SUMS.txt and stages the package manifest and GUI bundle outside the watched plugin directory; settings, credentials and usage history remain untouched. It does not execute downloaded scripts. Checksums are not independent code signatures. If updating fails, close OpenCode and reinstall a trusted portable ZIP. The previous two files are retained in `.update-backup` in the plugin directory. A leftover `.update-lock` blocks further automatic updates; close OpenCode and use the trusted installer to recover, then remove the lock only after verifying the installation.

## Deferred activation

Pending operations are stored in `.usage-dashboard-pending` under the OpenCode configuration root. One operation can be queued at a time. If the worker was interrupted, use `Apply.cmd` from the extracted Portable archive when OpenCode has exited. `Rollback.cmd` restores the latest saved package/bundle pair for an existing installation. Settings and caches remain in place. Existing installations need a one-time install with the new Portable package to acquire the trusted activation helper. Automatic updates do not run downloaded scripts.

Process-name detection is best effort and cannot identify all custom or remote servers. A quick restart may race activation; if the worker sees a running process it waits, and an interrupted operation may need manual recovery. No live OpenCode integration test has yet been performed.

## Upgrading and removal

The installer no longer downloads or installs a browser runtime. It removes
known obsolete companion files, pairing files, the former window helper and
the retired plugin-owned runtime when its installation receipt is present.
Existing settings, provider connections and unrelated files are preserved.
Older private Billing profiles are not used and are not deleted on upgrade.
Remove the retired companion from your browser's extension manager if you
previously installed it.

Installation, update, removal and rollback can be queued while OpenCode runs. A local PowerShell worker applies the queued operation only when no OpenCode-named process is detected. It never terminates processes. To
uninstall, run `Uninstall.cmd`. Normal uninstall preserves settings and cache.
The PowerShell uninstaller's `-PurgeCachedData` option also removes local plugin
data, including retired private profiles. It is not required for the new version.

## If the plugin appears in Extensions but the icon is missing

- Confirm OpenCode **Desktop**, not an unsupported interface.
- Confirm a supported layout: **Side tabs**, **Inbox**, or **Top tabs**.
- Restart OpenCode after installing or changing the interface layout.
- Indicator placement currently depends on experimental OpenCode DOM
  structures, which can change between desktop versions.
- If the plugin reports an initialization error, capture its *sanitized*
  error message and the Desktop version; report it in GitHub Issues.

## Missing OpenAI/Codex quota data

OpenAI/Codex 5-hour and weekly subscription quota retrieval currently requires
**Codex browser (legacy)** or **Codex device code (legacy)** under the OpenAI
provider. The modern **Sign in with ChatGPT** flow does not provide the quota
endpoint permissions that this plugin needs. This does not affect other
providers' supported metrics.

## API balances

Balances require supported provider APIs. Missing values do **not** mean a
zero balance. Availability reasons are visible in each account card; expand
**Statistics & details** for additional readings. See [provider metrics](PROVIDER_METRICS.md). For OpenAI API, actual
prepaid credit balance is unavailable; configured Admin API keys still permit
organization cost and budget reporting. Browser-derived balances are retired.

## OpenCode and OpenCode Go

Connect the account in OpenCode's provider settings. OpenCode pay-as-you-go
(also known as Zen) appears as an API account. Its existing key or OAuth
connection is used for [Console budgets and credits](OPENCODE_BUDGETS.md).
No extra sign-in is required. If access is denied, the affected metric remains
unknown. OpenCode Go appears as a subscription even when authenticated with
an API key. Its official usage endpoint provides 5-hour, weekly and monthly
windows. Connected accounts remain visible when usage is unavailable.
