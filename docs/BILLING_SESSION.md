# Billing Session (OpenAI API and OpenCode Zen)

Billing Session is the optional way to read a visible prepaid USD
balance without a browser extension. Each connected API account has a separate
persistent browser profile. A new session uses the current user's Windows
default HTTPS browser if it is a recognized Chromium browser and its executable
is available. Otherwise, Usage Dashboard asks the user to choose from the
compatible browsers it finds installed. The default browser setting is never
changed. It does not use your normal browser profile or extract credentials
from OpenCode.

## Browser catalog (Windows)

| Browser family | Recognized editions |
| --- | --- |
| Microsoft Edge | Stable, Beta, Dev, Canary |
| Google Chrome | Stable, Beta, Dev, Canary |
| Brave | Stable, Beta, Dev, Nightly |
| Opera | Stable, GX, Beta, Developer |
| Vivaldi | Stable, Snapshot |
| Chromium | Chromium |
| Other Chromium derivatives | Yandex Browser, Thorium, Slimjet, Cent Browser, Coc Coc, Avast Secure Browser, AVG Secure Browser |

The catalog contains 26 browser variants. The system HTTPS registration and
known installation paths are used for detection. For a recognized default
browser installed outside the usual directories, the registered local executable
may also be used. The account card lists the installed alternatives it detects.

Playwright provides dedicated channels for Chrome and Edge. Other Chromium
derivatives use their installed executable with the Chromium automation engine.
These additional browsers are experimental: detection and launch configuration
do not guarantee that every version, distribution, authentication flow or
headless billing read will work. Portable or nonstandard installations may
not be detected if they lack a recognized registration and known executable path.

Stock Firefox, Firefox-based browsers and Safari are not supported by this
runtime; Playwright requires patched Firefox and WebKit builds rather than the
ordinary installed browsers. See [Playwright browser compatibility](https://playwright.dev/docs/browsers)
and [browser launch options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch).

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
4. Verify that the page corresponds to this API key. On Windows, the plugin
   observes the dedicated browser through UI Automation and attempts a
   graceful close when it recognizes an explicit balance on the loaded
   Billing page. The page and window must remain stable for at least eight
   seconds. If automatic closure is unavailable, close all windows of the
   dedicated login profile yourself. Do not close unrelated browser profiles.
   After the browser exits, Usage Dashboard checks navigation records for
   this login attempt, attempts a headless read using the existing session,
   and completes the connection if the balance is recognized. An explicit
   zero balance is valid. No URL input, confirmation button or open popup
   is required.
5. Subsequent reads happen in a headless browser on the configured refresh
   interval, while OpenCode Desktop is running. A manual refresh also requests
   a billing update. The browser is closed after each read.

Repeat the procedure for each account that needs a balance. Starting the
connection authorizes automatic completion for that API account. The
organization or workspace is selected by the user in the browser, not
independently verified by the provider API. Missing or ambiguous Billing
pages prevent automatic binding.

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
- Automatic window closure is experimental. It requires a visible, single-tab
  browser window owned by the exact spawned process and dedicated profile,
  an unambiguous loaded Billing document, and a recognized USD balance.
  The helper revalidates the evidence before requesting the standard Windows
  UI Automation window close. Browser builds that do not expose the necessary
  accessibility information, multiple windows/tabs, a modal dialog or a
  minimized window can prevent closure. The dedicated browser starts with
  Chromium's standard accessibility mode enabled, without a debugger or
  automated authentication. In unsupported cases close the dedicated window
  manually. The plugin never forcibly terminates the login browser.
- Window diagnostics identify the failed check: W01 (window ownership or
  uniqueness), W02 (accessible Billing document), W03 (single selected tab),
  W04 (visible balance), W05 (accessibility helper unavailable).
- The background reader allows up to 30 seconds for the balance to appear
  after navigation. It recognizes explicit English and Russian credit-balance
  labels, adjacent or nested amounts, explicit USD currency markers, fractional
  credits and supported localized number formats. It does not substitute
  spending limits or arbitrary dollar amounts for credit balance.
- Background diagnostics identify the failed check: R01 (balance label not
  found), R02 (USD amount not recognized), R03 (conflicting amounts), R04
  (document read failed), R05 (navigation failed). If reporting an issue,
  include the code and provider name, not account details or raw page content.
- Connection completes automatically after the browser exits. It retries
  briefly if navigation data is still being saved or the profile is locked.
  If automatic closure was requested, the discovered Billing page must match
  the page observed before closure. If a terminal error remains, use
  **Reconnect Billing** to begin a new attempt.
- Keep OpenCode Desktop running until the initial connection completes. If it
  is restarted during an unfinished login attempt, reconnect to start again.
- If page detection finds no Billing page, reopen the dedicated browser and
  visit the correct provider's Billing page before closing it.
- If several distinct Billing pages are found, reopen the dedicated browser and
  visit only the page for the intended account in the new login attempt.
  The plugin does not guess which organization or workspace you intended.
- Automatic detection reads only allowlisted Billing URLs from the dedicated
  profile using the host's read-only SQLite API, with an unencrypted Chromium
  session-file fallback. A browser that does not save history, changes its
  storage format, or encrypts the fallback session file may be unavailable.
  No decryption, credential extraction or inspection of personal browser
  profiles is attempted.
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
detected Billing URL is validated against fixed provider origins and Billing
paths, stripped of unrelated query parameters and retained only in the private
local binding. The reader examines only the dedicated profile, after the
ordinary login browser closes, and retains only recognized Billing URLs from
the current login attempt. It does not read cookies, saved passwords, page
titles or OAuth parameters. No navigation records or URLs are returned to
the renderer. The ordinary login browser has no Playwright or debugging
connection. A bundled Windows PowerShell helper observes only the verified
dedicated browser window through Windows UI Automation. It checks the loaded
document address before inspecting adjacent accessible Billing balance text;
it does not interact with sign-in forms, read password fields, inject input,
or inspect personal browser windows. Only fixed status, a canonical Billing
URL and an ephemeral window handle are returned to the main process.
Subsequent headless reads use a private automation pipe and retain browser
sandboxing. No external debugging listener or personal browser profile is used.

Normal uninstall preserves local user data for reinstall. To remove saved
billing sessions, disconnect them first or run the uninstaller with
`-PurgeCachedData` after closing OpenCode Desktop and the billing windows.
