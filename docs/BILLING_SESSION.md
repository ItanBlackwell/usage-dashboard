# Billing Session (OpenAI API and OpenCode Zen)

Billing Session is the optional way to read a visible prepaid USD
balance without a browser extension. Each connected API account has a separate
persistent browser profile. A new session uses the current user's Windows
default HTTPS browser if it is Microsoft Edge or Google Chrome and its
executable is available. Otherwise, Usage Dashboard asks the user to choose
from the supported browsers it finds installed. Other browsers, including
Firefox, Brave, Opera and Vivaldi, are not supported by this implementation.
The default browser setting is never changed. It does not use your normal
browser profile or extract credentials from OpenCode.

The confirmed session retains its browser even if the system default changes.
If that browser is no longer available, explicitly choose an installed
alternative and sign in again. Browser authentication is not transferred
between browsers.

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
   select **Connect Billing**. A normal browser window opens using a dedicated
   profile, with no Playwright or debugging connection during authorization.
2. Sign in yourself, including any provider security checks, Google sign-in
   if offered by the provider, or MFA. Do not enable browser sync.
   Select the organization or workspace that actually owns the connected API key.
3. Open the Billing page. For OpenAI, use
   [Billing overview](https://platform.openai.com/settings/organization/billing/overview).
   For Zen, select the workspace in [OpenCode Console](https://opencode.ai/console)
   and open its Billing settings.
4. Verify that the page corresponds to this API key. Copy its address and
   close **all windows of the dedicated login profile**. Do not close unrelated
   browser profiles. Return to Usage Dashboard and paste the address into the
   Billing field, then select **Confirm account**. Reopen the popup if needed.
   The plugin now attempts a headless read of that specific Billing page using
   the existing session. A recognized explicit balance (including zero) is saved.
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

- Google and other identity providers may reject automated browsers.
  Sign-in is performed in the ordinary browser window; the plugin does not
  automate authentication, modify browser security settings, or attempt to
  bypass verification. If sign-in is still refused, use another login method
  officially offered for the same provider account, or leave Billing disconnected.
- If the session expires, headless access is denied, or the provider requires
  interactive verification, select **Reconnect Billing** and sign in manually.
  If the provider does not permit headless reads, the balance remains unavailable.
- If the login browser is still open, close its dedicated windows and retry
  confirmation. The plugin never terminates your login browser.
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
Do not copy, publish or share this directory. No cookies, tokens or raw page
content are sent to the renderer or included in the metrics cache. Only a
sanitized account ID, status, amount and timestamp are published. The
user-pasted Billing URL is validated against fixed provider origins and
Billing paths, stripped of unrelated query parameters and retained only in
the private local binding. The ordinary login browser has no automation
connection. Subsequent headless reads use a private automation pipe and
retain browser sandboxing. No external debugging listener or personal
browser profile is used.

Normal uninstall preserves local user data for reinstall. To remove saved
billing sessions, disconnect them first or run the uninstaller with
`-PurgeCachedData` after closing OpenCode Desktop and the billing windows.
