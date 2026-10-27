---
layout: ../../layouts/DocsLayout.astro
title: "Configuration"
description: "The Light WAF core configuration reference — proxy and backend, TLS, scoring and the block threshold, rate limiting, client-IP resolution, request limits, detection modules, CRS rules, WASM plugins and the resilience posture."
---

<!-- SPDX-FileCopyrightText: 2026 0x00spor3
     SPDX-License-Identifier: Apache-2.0 -->

# Configuration

<p class="lede">The proxy reads one TOML file (<code>--config</code>). This page covers the core sections, read by both the <code>waf</code> and the <code>waf-enterprise</code> binary. The <code>[enterprise.*]</code> tables are on <a href="/docs/components">At-scale components</a>.</p>

The core sections are `[proxy]`, `[tls]`, `[waf]`, `[rate_limit]`, `[network]`, `[limits]`,
`[resilience]` and `[modules.*]`. The component tables live in the same file. The repository's
[`examples/`](https://github.com/0x00spor3/Light-WAF/tree/main/examples) folder has complete,
commented profiles — from *detection-only* to *strict*, behind a CDN, JSON APIs.

## Proxy & backend

```toml
[proxy]
listen  = "0.0.0.0:8080"          # where the WAF accepts client traffic
backend = "http://127.0.0.1:8000" # your origin; the WAF forwards allowed requests here
```

## TLS

TLS termination is **off by default** — the listener serves cleartext (HTTP/1.1 + h2c). When you turn
it on, the listener serves **only** TLS on that port (no cleartext fallback), and an unreadable
certificate at boot is **fatal** (fail-closed, never a silent downgrade).

```toml
[tls]
enabled   = true
cert_path = "/etc/waf/tls/cert.pem"   # PEM chain, leaf first
key_path  = "/etc/waf/tls/key.pem"    # PKCS#8 / PKCS#1 / SEC1
alpn      = ["h2", "http/1.1"]
```

Automatic certificates (ACME) and client-certificate authentication (mTLS) are provided by the
[managed TLS component](/docs/components#managed-tls).

## Detection & the block threshold

```toml
[waf]
mode            = "blocking"   # "blocking" (enforce) | "detection-only" (observe and log)
block_threshold = 5            # deny when the anomaly score reaches this
paranoia_level  = 1            # 1..=4 — higher activates more (and noisier) rules
```

### Severity scores

This table maps each rule's severity to the points it adds to the score. **This, together with
`block_threshold`, is your main tuning surface** (see [Concepts](/docs/concepts#points-come-from-severity)).

```toml
[waf.severity_scores]
critical = 6   # a single critical (6) blocks on its own at threshold 5
error    = 4
warning  = 3   # two warnings (3+3) also block
notice   = 2   # a lone notice never blocks
```

To make the WAF stricter, lower `block_threshold` or raise severities. To reduce false positives on a
noisy rule class, lower that severity so it only contributes in combination.

## Rate limiting

An L7 token bucket applied at connection time, keyed per client.

```toml
[rate_limit]
enabled          = true
key              = "client_ip"
requests         = 100        # tokens per window
window_seconds   = 60
burst            = 100        # bucket capacity (default = requests)
action           = "block"    # "block" → 429 | "score" → add `score` points instead
score            = 5          # points when action = "score"
max_tracked_keys = 100000     # memory cap; idle buckets are swept
```

`[rate_limit]` sets the **policy** (capacity/refill). *Where* the bucket state lives — single-node
memory or a cluster-wide Redis — is decided by the
[Redis state component](/docs/components#cluster-wide-rate-limiting).

## Client-IP resolution

The client IP is derived **once** and reused by rate limiting, logging, and reputation. It is
fail-safe: with `trusted_proxies` empty, the `X-Forwarded-For` header is **always ignored** and the
peer socket address is used — an unconfigured deploy cannot be spoofed.

```toml
[network]
trusted_proxies  = ["10.0.0.0/8", "::1"]   # CIDRs of YOUR proxies/LBs/CDNs
client_ip_header = "X-Forwarded-For"
trusted_hops     = 1                        # hops to trust counting from the RIGHT (never the first IP)
```

> If your WAF sits behind a load balancer or CDN and you do **not** set `trusted_proxies`, every
> request appears to come from the LB's IP — and per-IP rate limiting throttles everyone together.
> Set `trusted_proxies` to your infrastructure's ranges.

## Request limits

Structural caps that reject malformed or oversized requests before content inspection (a `rejected`
verdict).

```toml
[limits]
max_body_size   = 1048576   # 1 MiB
max_header_size = 8192      # per header
max_headers     = 100
max_params      = 100
max_cookies     = 50
max_json_depth  = 20
```

## Detection modules

Native rule modules, each toggled on its own table. All are on by default in the sample config. They
contribute to the anomaly score by severity — none blocks unilaterally. See the
[module catalogue](/docs/modules) for what each one catches.

```toml
[modules.sqli]
enabled = true

[modules.xss]
enabled = true

# …and likewise: path_traversal, rce, lfi_rfi, ssrf, ldap, nosql, mail, ssti,
#   scanner, ssi, xxe, header_injection, request_smuggling
```

### Structural protocol protections (opt-in)

GraphQL and gRPC caps guard the **shape** of an operation (depth/aliases/fields/batch), not its
content — like `request_smuggling`. They are endpoint-specific, so they default off and need tuning.

```toml
[modules.graphql]
enabled             = false
paths               = ["/graphql"]
max_depth           = 15
max_aliases         = 30
max_fields          = 1000
max_directives      = 50
max_batch           = 10
block_introspection = false        # true → __schema/__type return 403

[modules.grpc]
enabled           = false
max_message_bytes = 4194304        # 4 MiB
max_fields        = 4096
max_depth         = 16
on_compressed     = "reject"       # opaque compressed payload: "reject" | "passthrough"
```

To validate operations against your app's real schema (unknown fields, types, methods), add
[schema enforcement](/docs/components#graphql--grpc-schema-enforcement).

## CRS rules

The CRS engine loads SecRule `.conf` files — OWASP CRS or your own. A boot-time report lists any
rules skipped as outside the supported subset. This is also the file the
[node agent](/docs/rule-management) manages when you use governed rule management.

```toml
[modules.crs]
enabled = true
files   = ["/etc/waf/managed.conf"]   # one or more SecRule .conf files
```

## WASM plugins

The Proxy-Wasm runtime loads `.wasm` filters as detection modules, with per-request fuel and memory
caps and a fail-closed posture. A plugin that fails to compile is logged and skipped at boot.

```toml
[modules.wasm]
enabled = true

[[modules.wasm.plugins]]
path   = "/etc/waf/denylist.wasm"
config = "block=/admin"            # optional, passed to the plugin
```

To accept only plugins signed with a key you trust, use
[signed WASM plugins](/docs/components#signed-wasm-plugins).

## Resilience

Explicit posture for when the **WAF itself** is in trouble — see also
[Operations](/docs/operations#resilience-posture).

```toml
[resilience]
on_upstream_error   = "fail_closed"   # origin down/timeout → 502 (closed) | 503 (open, retryable)
on_internal_error   = "fail_open"     # a module panic must not take down the site
on_config_error     = "fail_open"     # a bad reload → keep last-good config
on_parser_limit     = "fail_closed"   # normalization failed → 400 (closed) | forward un-inspected (open)
upstream_timeout_ms = 30000
```
