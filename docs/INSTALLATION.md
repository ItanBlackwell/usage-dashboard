# Installation and troubleshooting (Windows)

## Portable installation

1. Download `Usage-Dashboard-Portable-<version>.zip` from
   [Releases](https://github.com/ItanBlackwell/usage-dashboard/releases).
2. Extract the archive **before** running anything. Close OpenCode Desktop
   completely (including any background instance).
3. Open the extracted `Usage-Dashboard` directory and double-click
   `Install.cmd`. Windows PowerShell is part of Windows; no separate Node.js or
   OpenCode CLI installation is needed.
4. Reopen OpenCode Desktop.
5. Under **Settings → General → Interface layout**, select **Side tabs** or
   **Inbox**. The indicator lives at the bottom of the left sidebar.

The installer puts files into
`%USERPROFILE%\.config\opencode\plugins\usage-dashboard` by default,
or an absolute `OPENCODE_CONFIG_DIR` if you configured one. Do not add a second
plugin entry to `opencode.jsonc`: OpenCode automatically discovers the folder.

## Optional Billing companion setup

The normal `Install.cmd` entry point prepares the extension and its local
pairing, chooses Edge first (Chrome only if Edge is not installed), copies
the actual installed extension path to the clipboard when available, and
opens the browser's extensions page. Browser setup is optional and a failure
does not undo the plugin installation.

**Manual steps in the selected browser profile:**

1. Enable Developer mode on `edge://extensions` or `chrome://extensions`.
2. Select **Load unpacked** and paste/select the installed extension folder.
   If the extension is already loaded from that folder, use **Reload** instead.
3. Enable **Usage Dashboard · Billing**, approve any required site permissions,
   and optionally pin it to the toolbar.
4. Return to the installer and type `O` to open both provider entry pages,
   or press Enter to skip. Sign in yourself to the matching organization
   or workspace. In OpenCode Console select Settings → Billing.
5. Keep one billing tab per provider, reload tabs that were already open,
   and restart OpenCode Desktop. Check the extension badge.

To skip the browser setup, run `Install.cmd -SkipBrowserSetup`.
Direct PowerShell invocation of the installer is non-interactive by default;
pass `-SetupBillingCompanion` only when the user is present.
No browser profile, browser policy or default-browser setting is modified.

See [BROWSER_EXTENSION.md](BROWSER_EXTENSION.md) for details.

## Uninstallation

Close OpenCode and double-click `Uninstall.cmd` from the extracted distribution.
The uninstall preserves user settings for an optional later reinstall.
If you loaded the Billing companion, remove it manually from the extensions
page of the browser profile in which you installed it.

## If the plugin appears in Extensions but the icon is missing

- Confirm OpenCode **Desktop**, not an unsupported interface.
- Use **Side tabs** or **Inbox**, not **Top tabs**.
- Restart OpenCode after installing or changing the interface layout.
- The left-sidebar button currently depends on experimental OpenCode DOM
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

Balances require specific provider APIs or, for OpenAI and OpenCode Zen prepaid
balances, the optional browser companion described in [BROWSER_EXTENSION.md](BROWSER_EXTENSION.md).
Missing/unavailable metrics do **not** mean a $0 balance.

## OpenCode and OpenCode Go

Connect the account in OpenCode's provider settings. OpenCode pay-as-you-go
(also known as Zen) appears as an API account; its credit balance can be read
from a supported, signed-in Billing page by the companion. Otherwise it is
unknown. OpenCode Go appears as a subscription even
when authenticated with an API key. It uses the official Go usage endpoint
for 5-hour, weekly and monthly windows. If the endpoint denies access or
returns no usable metrics, the connected account remains visible with unknown
limits. Unconnected catalog entries are not displayed.

