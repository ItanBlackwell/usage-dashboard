# Billing Session (OpenAI API and OpenCode Zen)

Billing Session is the optional way to read a visible prepaid USD
balance without a browser extension. It uses the installed Microsoft Edge
browser first, or Google Chrome if Edge is absent, with a separate persistent
browser profile for each connected API account. It does not use your normal
browser profile or extract credentials from OpenCode.

## Installation

Install the Portable package with `Install.cmd` and restart OpenCode Desktop.
The Portable ZIP contains a pinned Playwright Core runtime; no separate Node.js,
browser extension or Developer mode is required. The source ZIP installer
downloads the same locked npm archive and verifies its SHA-512 integrity.
If runtime setup fails, direct provider APIs still work; rerun the installer
after resolving the reported error. Verify that the installer reports
`Billing runtime <version> installed and ready for browser launch.` Windows
PowerShell 5.1 is supported; the installer reads the flat, integrity-pinned
runtime manifest rather than directly deserializing npm's lockfile.

## Required manual authorization

1. Open Usage Dashboard, locate the OpenAI API or OpenCode API card, and
   select **Connect Billing**. An isolated browser window opens.
2. Sign in yourself, including any provider security checks or MFA.
   Select the organization or workspace that actually owns the connected API key.
3. Open the Billing page. For OpenAI, use
   [Billing overview](https://platform.openai.com/settings/organization/billing/overview).
   For Zen, select the workspace in [OpenCode Console](https://opencode.ai/console)
   and open its Billing settings.
4. Return to Usage Dashboard and select **Confirm account** only after checking
   that the page corresponds to this API key. Reopen the popup if it closed.
   A recognized explicit balance (including zero) is saved. The browser window
   then closes. Keep only one matching Billing page in that isolated window.
5. Subsequent reads happen in a headless browser on the configured refresh
   interval, while OpenCode Desktop is running. A manual refresh also requests
   a billing update. The browser is closed after each read.

Repeat the procedure for each account that needs a balance. The association is
user-confirmed, not independently verified by the provider API.

## Troubleshooting and disconnect

Clicking Connect Billing displays an immediate progress indicator. If the host
cannot provide a usable account inventory, the plugin retries it once and
reports the failure. Browser/runtime/IPC errors are shown on the account card
and retained while the Desktop window remains open. They contain no private
paths, URLs or authentication data. Codes B01–B05 distinguish a missing IPC
client, failed connection check, rejected command, unavailable status and
protocol mismatch. If an IPC code persists, report that code and the OpenCode
Desktop version. Main-process diagnostics record only fixed command outcomes.

- If login expires or the provider requires interactive verification, select
  **Reconnect Billing** and sign in manually again. No verification bypass
  is attempted.
- If no unambiguous amount is visible, the plugin does not assume zero.
  Check the correct organization/workspace and billing permissions. A redesign
  or localization of the page can make the experimental extractor unavailable.
- A last confirmed value may be retained after a temporary failure; its
  status and observation time distinguish it from a fresh reading.
- **Disconnect** removes this account's dedicated profile and binding.
  If the browser is still open and removal fails, close it and retry.
- The retired browser companion is not supported. Connect each API account
  through Billing Session; older extension-derived balances are not reused.

## Privacy

The browser handles sign-in and stores its own session in the dedicated
`.usage-dashboard-userdata/billing-sessions` directory under the OpenCode
configuration root. Browser storage contains sensitive authentication data.
Do not copy, publish or share this directory. No cookies, tokens, raw page
content, or private billing URLs are sent to the renderer or included in the
metrics cache. Only a sanitized account ID, status, amount and timestamp are
published. The private local binding retains the selected billing URL.
The browser runs with its sandbox enabled and a private automation pipe;
no external debugging listener or personal browser profile is used.

Normal uninstall preserves local user data for reinstall. To remove saved
billing sessions, disconnect them first or run the uninstaller with
`-PurgeCachedData` after closing OpenCode Desktop and the billing windows.
