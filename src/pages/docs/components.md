---
layout: ../../layouts/DocsLayout.astro
title: "At-scale components"
description: "Configure the Light WAF at-scale components in waf-enterprise — Redis state and cluster-wide rate limiting, managed ACME TLS and mTLS, IP reputation and threat feeds, curated CRS rules, GraphQL/gRPC/OpenAPI schema enforcement, bot detection, signed WASM plugins and request capture."
---

<!-- SPDX-FileCopyrightText: 2026 0x00spor3
     SPDX-License-Identifier: Apache-2.0 -->

# At-scale components

<p class="lede">The data-path components are wired into the <code>waf-enterprise</code> binary and configured in the same TOML file as the core, under <code>[enterprise.*]</code> and <code>[tls.*]</code> tables. All of them are default-off, opt-in, and additive to the same anomaly score.</p>

> A file with no `[enterprise.*]` tables (or all disabled) behaves exactly like the core `waf`
> binary. The name *enterprise* survives in the binary and the config tables from when the
> components were licensed separately; today everything is Apache-2.0.

Every component's whole config is in the commented sample
[`examples/enterprise.toml`](https://github.com/0x00spor3/Light-WAF/blob/main/examples/enterprise.toml),
and each has a copy-paste runbook under
[`scripts/`](https://github.com/0x00spor3/Light-WAF/tree/main/scripts).

## Cluster-wide rate limiting

Share one rate-limit budget across all WAF nodes via Redis (atomic server-side `try_acquire`). This
sets only *where* the bucket state lives; the policy stays in
[`[rate_limit]`](/docs/configuration#rate-limiting).

```toml
[enterprise]
redis_url = "redis://10.0.0.5:6379"   # absent ⇒ in-memory single-node store
pool_size = 32
fail_open = true                       # Redis error at RUNTIME: true = allow | false = deny.
                                       # An unreachable Redis at BOOT is always fatal.
```

`WAF_REDIS_URL` overrides `redis_url` for ops/CI.

## Managed TLS

`waf-tls-managed` obtains and rotates certificates automatically — **hitless** (no acceptor rebuild on
renewal). When enabled, `cert_path`/`key_path` are ignored; `[tls].enabled` still governs on/off.

```toml
[tls.acme]
enabled   = true
domains   = ["waf.example.com"]      # SANs; dns-01 supports wildcards "*.example.com"
email     = "ops@example.com"
strategy  = "tls-alpn-01"            # "tls-alpn-01" (default) | "dns-01"
cache_dir = "acme-cache"             # persists the account + cert across restarts
staging   = true                     # true = CA staging (avoid Let's Encrypt prod rate limits)
```

- **`tls-alpn-01`** proves control on the same port via the `acme-tls/1` ALPN. Needs a reachable
  public IP on that port.
- **`dns-01`** proves control by publishing a TXT record — works behind NAT and for **wildcards**. It
  needs a provider block and credentials in the environment (never in the file):

```toml
[tls.acme]
strategy = "dns-01"
provider = "cloudflare"              # "cloudflare" | "route53"

[tls.acme.dns]
zone_id                  = "<zone or hosted-zone id>"
propagation_timeout_secs = 120       # wait for the TXT to appear on the authoritative NS
renewal_days             = 60        # renew ahead of the ~90-day LE lifetime
```

| Provider | Environment variables |
|---|---|
| `cloudflare` | `CF_API_TOKEN` |
| `route53` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (+ optional `AWS_SESSION_TOKEN`, `AWS_REGION`) |

**Clustered DNS-01** (`cluster = true`) coordinates multiple nodes through Redis so exactly one node
issues for the whole cluster and the others converge. It requires `[enterprise].redis_url` and
`WAF_CERT_STORE_KEY` (encrypts the private key at rest).

### Mutual TLS (client certificates)

```toml
[tls.mtls]
enabled = true
ca_path = "/etc/waf/clients-ca.pem"   # PEM bundle of trusted client CAs
```

With `enabled = false` there is no client authentication — exactly the core behavior.

## IP reputation & threat-intel feed

A connection-phase module reads the client IP's reputation from the same Redis (keyspace `rep:<ip>`)
and contributes to the score. A background **feed** populates that keyspace from IP lists. Both
require `redis_url`.

```toml
[enterprise.reputation]
enabled             = true
malicious_severity  = "critical"   # a malicious IP alone can cross the threshold
suspicious_severity = "warning"

[enterprise.reputation.feed]
enabled               = true
refresh_interval_secs = 300         # single-writer: one node per cycle fetches (distributed lock)
lock_ttl_secs         = 90

[[enterprise.reputation.feed.sources]]
kind     = "http"                   # "file" (local path) | "http" (HTTPS URL)
location = "https://example.com/blocklist.txt"
verdict  = "malicious"              # malicious | suspicious
```

Entries expire (TTL), so a de-listed IP ages out and a dead feed degrades to *Unknown* (fail-safe).
v1 handles exact IPs only (CIDRs are skipped with a warning).

## Curated CRS content

Loads curated rule content (CVE/app/evasion signatures: Log4Shell, Spring4Shell, cloud-metadata
SSRF, webshells, `.git`/`.env` exposure, …) through the core CRS engine. Additive to the same score.

```toml
[enterprise.crs_curated]
enabled = true
```

## GraphQL / gRPC schema enforcement

Validate every operation against your app's **real schema**. A field/type/method the real client
never sends is a probing signal and adds to the score. The schema file is mandatory when enabled, and
validated at boot (fatal if missing/invalid).

```toml
[enterprise.schema_enforcement]
enabled                = true
schema_path            = "/etc/waf/app.graphql"   # SDL; boot-fatal if missing/invalid
paths                  = ["/graphql"]
parse_error_severity   = "warning"
unknown_field_severity = "critical"

[enterprise.grpc_schema_enforcement]
enabled                 = true
descriptor_path         = "/etc/waf/app.bin"      # FileDescriptorSet from protoc/buf
unknown_method_severity = "critical"
decode_error_severity   = "warning"
flag_unknown_fields     = false                    # opt-in (protobuf tolerates unknown fields by design)
```

## OpenAPI positive security

Validate every REST/JSON request under the guarded path prefixes against your app's **real OpenAPI
spec** (3.0 or 3.1, as a JSON file). Routing uses the normalized path (decoded, traversal resolved),
so encoding tricks do not move a request out of scope; requests outside `paths` are left alone.

Two families of signals, both additive to the anomaly score:

- **Unknown surface** — `schema-api-unknown-route` (a path the spec does not declare) and
  `schema-api-method-not-allowed` (a declared path, undeclared method), scored with
  `unknown_route_severity`. This is the strong probing signal.
- **Contract violations** on a known operation — `schema-api-unknown-param`,
  `schema-api-missing-required`, `schema-api-type-violation`, `schema-api-unknown-property`,
  `schema-api-content-type` (a body that is not `application/json` / `+json` where the spec
  expects JSON), `schema-api-body-parse-error` — scored with the lower `violation_severity`.

Injection inside a parameter value (SQLi, XSS…) is still caught by the core detection modules; this
module checks the *shape* of the request, not its content. The spec is mandatory when enabled and
validated at boot (fatal if missing, invalid or not compilable). It is re-loaded on every config
reload; if the new spec is invalid the reload is aborted and the previous one stays active. The module
never fetches remote `$ref`s.

```toml
[enterprise.api_schema]
enabled                = true
spec_path              = "/etc/waf/openapi.json"   # OpenAPI 3.0/3.1, JSON; boot-fatal if missing/invalid
paths                  = ["/api"]                   # guarded path prefixes (default ["/api"])
unknown_route_severity = "critical"                 # undeclared path or method
violation_severity     = "warning"                  # contract violation on a declared operation
strict_params          = true                       # flag query parameters not declared for the operation
strict_body            = true                       # treat request bodies as additionalProperties:false
                                                    # even where the spec does not say so
```

With the default scores (warning = 3, critical = 6, block threshold 5), one contract violation alone
does not block, two different ones do, and an unknown route or method blocks on its own. To roll out
safely, run in `mode = "detection-only"` first and watch the `schema-api-*` hits in the decision log.
If a client legitimately sends fields your spec does not list, set `strict_body = false` (or fix the
spec) rather than lowering the severities.

## Bot / client-integrity detection

Native cross-header heuristics. v1 flags **browser impersonation**: a User-Agent that claims a modern
browser but sends no `Sec-Fetch-*` headers is a client pretending to be a browser (a curl/requests bot
doesn't send Fetch-Metadata). Additive (never a hard reject).

```toml
[enterprise.bot_detection]
enabled                        = true
browser_impersonation_severity = "critical"
```

## Signed WASM plugins

The core [`[modules.wasm]`](/docs/configuration#wasm-plugins) runtime loads unsigned `.wasm`
best-effort. This adds a **trust gate**: verify a detached minisign (ed25519) signature against
`trusted_keys` before loading. A signed plugin that fails verification is **boot-fatal**
(fail-closed).

```toml
[enterprise.wasm]
enabled      = true
exclusive    = true                         # reject any populated core [modules.wasm] (lockdown)
trusted_keys = ["RWQ...base64-minisign-pubkey..."]

[[enterprise.wasm.plugins]]
wasm_path = "/etc/waf/denylist.wasm"
sig_path  = "/etc/waf/denylist.wasm.minisig"
config    = "block=/admin"
```

Sign with `minisign -Sm plugin.wasm` (→ `plugin.wasm.minisig`); the `trusted_keys` entry is the
base64 line from the `.pub`.

## Request capture

Capture the **full denied request** (method/path/query, headers, cookies, body) so the control-plane
event drill-down can show exactly what was blocked — not just the metadata the decision log carries.
Optional, **off by default**, and it does **not** touch the data path: a pure observer buffers each
request in a bounded ring off-path, and a background shipper posts the captured denied requests to the
control plane on a **dedicated side-channel** (never the decision log — the body never travels in
logs). Overflow is dropped, never back-pressured onto the proxy.

It is **raw by default**, so treat it like a secret store: redact sensitive names here, keep the
control-plane retention short (see [Control plane](/docs/control-plane#configuration)), and know that
viewing a capture is RBAC-gated (`ViewCaptures`, operator and admin) and written to the signed audit
log.

```toml
[enterprise.capture]
enabled          = true
controlplane_url = "http://waf-controlplane:9600"  # the shipper appends /ingest/captures
token_env        = "WAF_CAPTURE_TOKEN"             # env holding the ingest bearer — never the token here
max_body_bytes   = 65536                            # bodies over this are truncated + flagged
ring_capacity    = 1024                             # ring bounds: entries …
ring_bytes       = 33554432                         #   … total bytes (32 MiB) …
ring_ttl_ms      = 5000                             #   … and TTL before an unshipped capture is evicted
queue_capacity   = 256                              # shipper backlog; full ⇒ drop (never block the proxy)

# Names replaced with ***REDACTED*** node-side (case-insensitive). Empty = raw. The redacted VALUE
# never leaves the node — only the redacted names are reported, to drive the UI banner.
[enterprise.capture.redaction]
headers     = ["cookie", "authorization", "set-cookie"]
body_fields = ["password", "token", "secret", "card"]
```

The ingest bearer comes from the environment (`WAF_CAPTURE_TOKEN`), matching the control plane's
`WAF_CP_API_TOKEN` (ingest is bearer-gated). Enabling capture without a `controlplane_url` is
boot-fatal (a capture that can never ship is a silent misconfiguration).

**Scope:** connection-phase rejects (rate limit) and parser-limit `400`s happen *before* inspection,
so those events keep metadata only — there is no captured body for them.
