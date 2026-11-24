# Provider metrics and availability

All reads use the exact account already connected in OpenCode. The plugin
does not create API keys, request additional permissions, launch a browser,
or change provider settings. Missing values are unknown, not zero.

## Available metrics

| Provider | Existing connection | Metrics |
| --- | --- | --- |
| DeepSeek | API key | Total wallet balance, topped-up and granted funds by currency, sufficient-funds flag |
| Moonshot / Kimi | API key | Available balance, cash and voucher components; USD or CNY according to the integration region |
| OpenRouter | API key | Key cap, all applicable workspace/member/key policy budgets, effective budget, reset period, expiration, free-model daily counter, daily/weekly/monthly/lifetime spend and BYOK spend |
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

OpenRouter's current-key response may return individual, workspace and guardrail
budgets even when the individual key limit is null. Each policy is shown
separately; the provider's effective budget is preferred for the indicator when
the wallet is unavailable. Never sum policies or treat a cap as a wallet balance.
The individual key reset and free-model daily reset use the documented midnight
UTC schedules; policy resets use the exact provider-supplied instant. A reset
or expiration makes the old remaining amount unknown until refreshed. Free-model
daily counters describe the provider's tier policy; exempt accounts and BYOK may
not be subject to the ceiling. Missing policy fields and an explicit empty
policy list are different availability states.
BYOK figures are shown separately and never added to the provider's spend
fields. Money amounts retain their currency.

## Endpoint contracts

- [DeepSeek balance](https://api-docs.deepseek.com/api/get-user-balance/):
  GET https://api.deepseek.com/user/balance.
- Moonshot: GET /v1/users/me/balance on api.moonshot.ai or api.moonshot.cn.
- [OpenRouter current key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key):
  GET https://openrouter.ai/api/v1/key; reads budgets, effective_budget and
  free_model_daily_requests as documented in [Limits](https://openrouter.ai/docs/api_reference/limits).
  GET /api/v1/credits only when the existing key explicitly identifies itself
  as management-capable.
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

The card displays provider spending and usage counters directly, including
key spending by period, organization usage, and available token or request
counts. More metrics expands secondary rows. Small positive expenses retain
sub-cent precision. Availability messages remain visible.

When an API wallet or general spending cap, or a subscription quota, is
unavailable, a separate local usage block shows today's and the current month's
recorded model cost, tokens and steps by provider (UTC). It uses the host's
[experimental session statistics API](https://opencode.ai/docs/api)
(`experimental.session.stats`, `tools: none`) with two bounded read-only
requests per refresh. Only known provider IDs are recognized; custom aliases
are not inferred from model names. Local statistics may include subscription
usage or imported history and do not include usage outside this server. They
are not provider charges and cannot identify historical credentials. Totals are
shown once per provider, never apportioned across accounts. Missing model rows
or failed reads remain unavailable; previous UTC periods are not shown as
current. Only aggregate numbers and period timestamps are cached, not chat
content, model identifiers, session identifiers or a second usage ledger.
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
