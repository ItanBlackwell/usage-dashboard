# Optional Billing browser companion

This Chrome/Edge extension is **optional**. It observes the displayed prepaid
USD balance on the OpenAI Platform Billing overview or OpenCode Zen workspace billing page and sends the numeric
amount to the local Usage Dashboard instance. It does not read or forward
browser cookies or API keys.

## Automatic preparation

Run `Install.cmd` after closing OpenCode Desktop. The installer copies the
extension to the installed plugin directory, creates a local pairing token
if needed (preserves it on upgrades), detects Microsoft Edge first and falls
back to Google Chrome only when Edge is absent. It copies the extension
folder path to the clipboard when available and opens the chosen browser's
extensions page. It cannot silently install or enable an unpacked extension.

To skip opening the browser and modifying the clipboard, use
`Install.cmd -SkipBrowserSetup`. If no supported browser is found, or the
browser cannot be opened, the main plugin remains installed.

## Required manual steps

1. Use the browser profile where you sign in to the provider sites. If the
   installer did not open the page, navigate to `edge://extensions` or
   `chrome://extensions`.
2. Enable **Developer mode**. If company policies prohibit it, do not bypass
   them; use an authorized browser/profile or skip the optional companion.
3. Click **Load unpacked** and select the installed directory printed by
   the installer (paste the path from the clipboard into the folder picker).
   The default is:
   `%USERPROFILE%\.config\opencode\plugins\usage-dashboard\browser-extension`.
   Do not load the source or extracted ZIP folder. The installed folder has
   a locally generated `pairing.json`; never commit or share that file.
   On upgrades, if the extension is already loaded from the same directory,
   click **Reload** instead of adding a duplicate.
4. Ensure **Usage Dashboard · Billing** is enabled. Approve required site
   permissions and optionally pin it to the toolbar.
5. Return to the installer and type `O` to open both provider entry pages,
   or open them yourself:
   - [OpenAI Billing overview](https://platform.openai.com/settings/organization/billing/overview):
     sign in and select the organization corresponding to your connected API key.
   - [OpenCode Console](https://opencode.ai/console): sign in, select the
     matching workspace and open **Settings → Billing**. The workspace
     owner/admin must have access to its credit balance.
6. Restart OpenCode Desktop. Reload the billing tabs after loading or
   reloading the extension. Keep only one billing tab per provider open in
   that browser profile. Verify that the organization/workspace matches the
   connected key; browser balances are shown only for a single connected API
   account per provider.

The companion reads only a recognized visible balance. Changes are detected
while the browser is open and the page is available. The installer never
changes browser security settings, installs browser policies, alters browser
profiles, signs in, or adds payment methods.

## Remove

Close OpenCode Desktop and run `Uninstall.cmd`. In the browser profile where
the companion was loaded, open the extensions page and manually remove
**Usage Dashboard · Billing**. The uninstaller does not edit browser profiles.

## Troubleshooting

Pin the browser extension to see its per-tab badge: `OK` means the amount
was accepted by the local receiver, `?` means no unambiguous balance was
found, `2+` means multiple billing tabs, and `ERR` means the local receiver
could not be reached or rejected the report. Reload the billing page after
reloading the extension. An accepted reading is shown only for a single
connected API account for that provider. The extension does not initiate paid
API requests. Unknown amounts remain unknown.

## Privacy and limitations

- HTTP receiver is bound to `127.0.0.1` only; default port `18746`.
- Browser→plugin messages use a generated pairing token. Keep it private.
- If either provider redesigns its Billing page, extraction may become unavailable.
- Do not treat an absent reading as a zero balance.
- Unloading the extension in Chrome/Edge stops further readings but does not
  automatically delete the local plugin cache.
- Do not load the extension from the source repository: that folder contains
  only `pairing.example.json`, not a real pairing token. Use the installed copy.
