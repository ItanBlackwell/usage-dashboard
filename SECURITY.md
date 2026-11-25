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
- OpenCode Console budget and prepaid credit reads use only the existing
  credential belonging to the corresponding connected account. OAuth requests
  require its selected workspace ID; key requests use the key's own workspace.
  Requests are read-only GETs to fixed official HTTPS endpoints with redirects
  disabled. Custom Console origins are refused, and old official Console
  metadata is mapped to the current official host. No credentials, workspace
  identifiers, policy IDs or raw responses are persisted or sent to the renderer.
- Budget and balance permission failures are handled independently. Missing
  values remain unknown; overlapping budgets are never summed. Invoiced
  credit lines are not reported as prepaid money.
- No browser automation, profile inspection, extension, pairing token or
  separate Billing IPC service remains. Old private profile files are not
  accessed. Migration removes known retired installed components only.
- No private snapshots, browser profiles or environment secrets are distributed
  with source or release archives.
- Extended provider metrics use a bounded whitelist of numeric values,
  currencies, fixed status codes and recognized public model identifiers.
  Raw response labels, private identities, credentials and cursors stay in
  the main process. Experimental routes are isolated by provider; every
  request is read-only, uses a fixed first-party host, rejects redirects and
  has a timeout. Claude analytics is explicitly organization-scoped, never
  attributed to the selected key alone. No new credentials or scopes are
  requested.
- Quota integration endpoints may change or become unavailable without notice.

## Contributor hygiene

Never commit `.env`, `settings.json`, local cache, access tokens, isolated
billing profiles, local bindings, or authenticated HTTP responses. Rotate any
credential accidentally disclosed.

## Release integrity

Release tags must match the package version and point to a commit in main.
Full CI, archive checksums and build provenance are required before publication.
Source distributions contain tracked files (or the distributed source manifest)
with additional exclusions and normalized ZIP metadata. Build from a clean,
trusted checkout. The manifest is not a signature; verify published checksums
and GitHub artifact attestations before using an archive.

Repository maintainers should enable branch and tag rulesets, private vulnerability
reporting, secret scanning and push protection in GitHub settings. Never bypass
failed security or installation checks to publish a release.
