# Optional OpenAI Billing browser companion

This Chrome/Edge extension is **optional**. It observes the displayed prepaid
USD balance on the OpenAI Platform Billing overview page and sends the numeric
amount to the local Usage Dashboard instance. It does not read or forward
browser cookies or API keys.

## Install

1. Install Usage Dashboard with `Install.cmd` and restart OpenCode Desktop.
2. The local extension directory is normally:
   `%USERPROFILE%\.config\opencode\plugins\usage-dashboard\browser-extension`.
3. In Chrome visit `chrome://extensions`; in Edge visit `edge://extensions`.
   Enable **Developer mode** and choose **Load unpacked**.
4. Choose the `browser-extension` directory above. It contains a locally
   generated `pairing.json`; never commit or share that file.
5. Open your own
   `https://platform.openai.com/settings/organization/billing/overview`
   page while signed in. The extension reads only a recognized visible balance.
   Changes are detected while the browser is open and the page is available.

## Privacy and limitations

- HTTP receiver is bound to `127.0.0.1` only; default port `18746`.
- Browser→plugin messages use a generated pairing token. Keep it private.
- If OpenAI redesigns the Billing page, extraction may become unavailable.
- Do not treat an absent reading as a zero balance.
- Unloading the extension in Chrome/Edge stops further readings but does not
  automatically delete the local plugin cache.
- Do not load the extension from the source repository: that folder contains
  only `pairing.example.json`, not a real pairing token. Use the installed copy.
