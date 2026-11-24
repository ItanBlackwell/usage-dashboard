# OpenCode Console budgets and credits

Usage Dashboard uses the existing OpenCode pay-as-you-go (Zen) account
connection. It does not create credentials, request additional sign-in,
launch a browser, or read browser storage.

## Metrics

- **Prepaid credits:** the workspace's actual available prepaid credit balance
  in USD, if the credential is permitted to read billing. An invoiced credit
  limit is not a prepaid balance.
- **Budget policies:** each applicable monthly spending allowance, the amount
  spent, the remaining allowance (clamped to zero if exceeded), and the
  provider-supplied reset time. Hover over a row for the scope and reset time.
  Policies may cover all spending or a subset of models, and may be individual
  or shared. They overlap, so never add their remaining amounts together.
  Per-model policies display the lowest remaining counter only when all
  returned model counters are explicitly available; otherwise the amount is
  unknown. A model-specific allowance is not a workspace-wide balance.
- The sidebar prefers an actual prepaid balance. If unavailable, it can show
  the tightest unexpired all-spend budget with an amber ring and a budget
  tooltip. Without either metric it shows an unknown value.

## Access and implementation

The main process reads the exact account's existing key or OAuth access token
from the OpenCode credential inventory. Console OAuth requires the selected
workspace metadata (`orgID`). A personal API key already belongs to a workspace.
The integration does not select another account or request new permissions.

The following read-only Console routes are **experimental** (not guaranteed
public API contracts):

- `GET https://opencode.ai/console/api/policies/current-budgets`, also used by
  OpenCode core's [usage limits service](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/usage-limits.ts).
- `GET https://opencode.ai/console/api/billing/status` for the observed prepaid
  credit schema. The explicit integer `balanceMicroCents` is divided by
  100,000,000 to obtain USD. Other billing modes are not mapped to prepaid
  balances.

Only the official Console host is allowed, with redirects disabled. Requests
are independent so a forbidden billing response does not hide an accessible
budget. A successful empty policy list means no applicable budgets were
returned, not a zero budget or a proof that a service account has no limit.
No raw response or credential is returned to the GUI or cache.

## Troubleshooting

A 401 indicates rejected authorization; a 403 indicates insufficient
permission. Existing key restrictions and workspace roles determine which
metrics are accessible. If a connection does not provide the required workspace
metadata or points to a custom Console host, the plugin does not send a request.
An unsupported response is not interpreted as zero. Use the standard OpenCode
provider settings for connection management.

See the official [budget rules](https://opencode.ai/docs/console/budgets/),
[API permissions](https://opencode.ai/docs/console/api/), and
[billing information](https://opencode.ai/docs/console/billing/).
OpenCode Go subscription windows and OpenAI organization cost monitoring are
separate integrations.
