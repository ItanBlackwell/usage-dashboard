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

## Billing Session setup

The default installer prepares the optional Playwright Core runtime but does
not open a browser or install an extension. Use the **Connect Billing** button
on the desired OpenAI or Zen API card after restarting OpenCode. Sign in
manually in the separate normal browser window. New sessions use the Windows
default browser if it is a supported installed Edge or Chrome; otherwise,
choose an available supported browser in the account card. Select the correct
billing organization/workspace, and copy the Billing page address. Close all
windows of that login profile. Paste the address in Usage Dashboard and click
**Confirm account**. Automated reading starts only after manual login.
See [Billing Session](BILLING_SESSION.md) for the complete instructions.

The Portable ZIP contains the verified runtime archive. Source ZIP installation
downloads it from npm and validates the locked SHA-512 hash. If the runtime
is unavailable, the direct provider integrations still work.

## Upgrading from the browser companion

The old browser extension and its local HTTP receiver have been removed.
Installation removes known obsolete companion files and pairing tokens from
the active plugin and saved user-data directories. Existing Billing Session
profiles, provider connections and settings are preserved. Old extension
balances are discarded because they are not bound to a confirmed account.
If the extension was loaded in Edge or Chrome, manually remove it from
`edge://extensions` or `chrome://extensions`. The installer does not edit
browser profiles or extension registrations.

## Uninstallation

Close OpenCode and double-click `Uninstall.cmd` from the extracted distribution.
The uninstall preserves user settings and isolated billing profiles for a later
reinstall. Disconnect billing sessions first or use the PowerShell uninstaller
with `-PurgeCachedData` to remove the private profiles and metrics cache.


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
balances, an authorized [Billing Session](BILLING_SESSION.md).
Missing/unavailable metrics do **not** mean a $0 balance.

If all API balances suddenly show dashes, refresh the popup and hover over an
amount to see the reason. A plugin service warning indicates an IPC failure;
previously confirmed values for the same account are retained when possible.
For OpenRouter, a missing balance may also indicate missing key permissions or
a failed provider request. For OpenAI and Zen, check the Billing Session status.

## OpenCode and OpenCode Go

Connect the account in OpenCode's provider settings. OpenCode pay-as-you-go
(also known as Zen) appears as an API account; its credit balance can be read
from a supported, signed-in Billing page by Billing Session. Otherwise it is
unknown. OpenCode Go appears as a subscription even
when authenticated with an API key. It uses the official Go usage endpoint
for 5-hour, weekly and monthly windows. If the endpoint denies access or
returns no usable metrics, the connected account remains visible with unknown
limits. Unconnected catalog entries are not displayed.

