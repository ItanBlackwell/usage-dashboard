# Provider metrics and availability

All reads use the exact account already connected in OpenCode. The plugin
does not create API keys, request additional permissions, launch a browser,
or change provider settings. Missing values are unknown, not zero.

## Available metrics

| Provider | Existing connection | Metrics |
| --- | --- | --- |
| DeepSeek | API key | Total wallet balance, topped-up and granted funds by currency, sufficient-funds flag |
| Moonshot / Kimi | API key | Available balance, cash and voucher components; USD or CNY according to the integration region |
| OpenRouter | API key | Key spending cap, remaining cap, reset period, expiration, daily/weekly/monthly/lifetime spend and BYOK spend |
| OpenRouter | Existing management-capable key | Wallet total credits, usage and remaining balance, independently of key cap |
| Claude | Existing API key with organization analytics permission | Calendar-month organization costs, tokens and requests, and per-model breakdown; documented beta |
| Kimi Code | Existing coding connection | Measured plan windows; experimental additional monthly windows and Extra Usage fields if returned |
| MiniMax M/Token Plan | Existing subscription key | Text quota windows and model/category breakdown, when explicit remaining counts or valid percentages are returned |
| Z.AI / GLM | Existing regional key | Experimental plan windows, 24-hour model/token/request and tool statistics, and explicit credit grant amounts/expiry |
| OpenCode | Existing Console connection | Applicable budgets and prepaid wallet where permitted; see [OpenCode budgets](OPENCODE_BUDGETS.md) |
| OpenCode Go | Existing connection | Subscription windows |
| OpenAI / Codex, Claude subscriptions | Supported OAuth | Existing subscription windows; Codex legacy authorization requirement unchanged |
| OpenAI API, Gemini API, Qwen API, MiniMax pay-as-you-go | Existing inference connection | No verified supported prepaid balance or budget read; the card explains this |

The OpenAI and Anthropic organization monitoring paths configured by existing
Admin API settings remain unchanged. They are not required for the additional
metrics above. Ordinary Claude workspace keys may receive 401 or 403 from the
analytics endpoint; no new administrative credential is requested. Claude
analytics costs are organization totals after discounts, before credits, not
wallet balances or per-key spend. The model rows are limited to the largest
16 reported models per report; the organization total covers all fully read
pages. Incomplete pages or a missing data freshness timestamp do not produce
a total.

OpenRouter reset instants are derived from the documented midnight UTC
daily/weekly/monthly schedules. Weekly resets are Monday UTC. A cap remains
distinct from the wallet; if the cap expires or resets before a fresh reading,
its old remaining amount is unknown. A key cap is not a payment balance.
BYOK figures are shown separately and never added to the provider's spend
fields. Money amounts retain their currency.

## Endpoint contracts

- [DeepSeek balance](https://api-docs.deepseek.com/api/get-user-balance/):
  GET https://api.deepseek.com/user/balance.
- Moonshot: GET /v1/users/me/balance on api.moonshot.ai or api.moonshot.cn.
- [OpenRouter current key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key):
  GET https://openrouter.ai/api/v1/key; GET /api/v1/credits only when the existing
  key explicitly identifies itself as management-capable.
- [Claude Usage and Cost Analytics](https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api):
  GET /v1/organizations/analytics/cost and /usage at api.anthropic.com, with
  the documented beta header. Costs are cents converted to USD.
- [MiniMax M Plan](https://platform.minimax.io/subscribe/coding-plan):
  GET /v1/token_plan/remains on the existing regional host. The legacy
  coding-plan endpoint has different counter semantics and is not substituted.
- Kimi Code: GET https://api.kimi.com/coding/v1/usages; the parser accepts
  recognized additional fields on this endpoint, but does not call the
  separate CLI OAuth service. Measured counts take precedence over the
  newer summary ratios; summary-only zero five-hour/weekly ratios are not
  trusted because of [reported counter discrepancies](https://github.com/MoonshotAI/kimi-code/issues/3908).
  Monthly and Extra Usage fields may be absent for existing plans/keys.
- Z.AI: the provider's [usage query tool](https://github.com/zai-org/zai-coding-plugins)
  uses /api/monitor/usage/{quota/limit,model-usage,tool-usage}.
  The plugin also attempts /api/paas/v4/user/credit_grants experimentally.
  Regional hosts are fixed to api.z.ai or open.bigmodel.cn. The monitor
  time range is 24 hours using the observed UTC+8 server wall clock.
  Model and tool responses are read independently; repeated summary lists
  are not counted twice. Credit grants require explicit currency, amount,
  used amount and expiry. Unverified units or ambiguous grant shapes are
  rejected; grants are never promoted to a prepaid wallet. The monitor cost
  field's units and actual billing semantics are not sufficiently established
  to report it as real money; the card identifies cost as not returned.

## Display and privacy

The card displays compact metric rows and a visible availability message for
unsupported or inaccessible metrics. More metrics expands secondary rows.
Authentication failures, permission errors, missing data, experimental
contracts and unsupported APIs are separate states. The sidebar continues to
prefer a real balance, or shows a separately marked key/general budget when
available. Subscription quotas are not money.

The main process uses fixed HTTPS destinations, no redirects, read-only
requests, and the existing refresh interval. Only validated numeric metrics,
known model identifiers, fixed notices and reset timestamps are passed to the
renderer and persisted. No provider response bodies or secrets are cached.
A passing fixture/installer CI run does not prove that a live account grants
access to a provider's API.
