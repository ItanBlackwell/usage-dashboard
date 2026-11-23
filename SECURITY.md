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
- The optional billing extension communicates with a loopback-only listener
  using a local pairing token created during installation.
- No production pairing tokens, billing snapshots or environment secrets are
  distributed with source or release archives.
- Quota integration endpoints may change or become unavailable without notice.

## Contributor hygiene

Never commit `.env`, `pairing.json`, `settings.json`, local cache, access tokens
or authenticated HTTP responses. Rotate any credential accidentally disclosed.
