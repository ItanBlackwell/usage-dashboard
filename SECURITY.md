# Security policy

## Supported versions

Only the latest published release is actively maintained. Older releases may
stop working when OpenCode Desktop or provider interfaces change.

## Report a vulnerability

**Do not post credentials, auth tokens, private logs or exploit details in public
GitHub Issues.** Use GitHub's private vulnerability reporting feature if it is
enabled on this repository, or contact the repository owner privately through
GitHub to arrange a secure reporting channel.

Provide the plugin version, OpenCode Desktop version, OS, a brief reproduction
and the potential impact. Redact all secrets and private account data.

## Security architecture

- Provider credentials remain in the OpenCode host process; GUI receives only
  sanitized usage metadata.
- Billing Session uses dedicated per-account browser profiles, never a user's
  existing browser profile. Manual login takes place in an ordinary browser
  with no automation connection. Only after the user closes that window and
  confirms an allowlisted Billing page address are headless reads attempted.
  Authentication remains in private local browser storage. The user-supplied
  canonical Billing URL is retained in a local binding, not the metrics cache.
  No automated sign-in, credential extraction or verification bypass is used.
  Provider pages return only a sanitized amount; browser sandboxing is retained.
- Browser selection reads the current user's HTTPS association without changing
  it. Only recognized supported browser identifiers and known installed browser
  executable locations are used; registry command strings are never executed.
- Billing Session requires no browser extension, pairing token or local HTTP
  receiver.
- No billing snapshots, browser profiles or environment secrets are distributed
  with source or release archives.
- Quota integration endpoints may change or become unavailable without notice.

## Contributor hygiene

Never commit `.env`, `settings.json`, local cache, access tokens, isolated
billing profiles, local bindings, or authenticated HTTP responses. Rotate any
credential accidentally disclosed.
