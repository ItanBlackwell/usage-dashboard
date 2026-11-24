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

## Uninstallation

Close OpenCode and double-click `Uninstall.cmd` from the extracted distribution.
The uninstall preserves user settings for an optional later reinstall.

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

Balances require specific provider APIs or, for the OpenAI prepaid balance,
the optional browser companion described in [BROWSER_EXTENSION.md](BROWSER_EXTENSION.md).
Missing/unavailable metrics do **not** mean a $0 balance.

## OpenCode and OpenCode Go

Connect the account in OpenCode's provider settings. OpenCode pay-as-you-go
(also known as Zen) appears as an API account; its credit balance is currently
unavailable in Usage Dashboard. OpenCode Go appears as a subscription even
when authenticated with an API key. It uses the official Go usage endpoint
for 5-hour, weekly and monthly windows. If the endpoint denies access or
returns no usable metrics, the connected account remains visible with unknown
limits. Unconnected catalog entries are not displayed.

