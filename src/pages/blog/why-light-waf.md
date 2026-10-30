---
layout: ../../layouts/BlogLayout.astro
title: "Light WAF: following one request through a WAF written in Rust"
description: "What Light WAF is and why it exists, then a walk through the code path of one malicious request: client-IP resolution, fixed-point decoding, a sound RegexSet prefilter, cumulative scoring, panic isolation and hot reload — plus the numbers and the limits."
date: "2026-10-30"
author: "0x00spor3"
---

<!-- SPDX-FileCopyrightText: 2026 0x00spor3
     SPDX-License-Identifier: Apache-2.0 -->

# Light WAF: following one request through a WAF written in Rust

<p class="lede">Light WAF is an open-source web application firewall written in Rust. It runs as a reverse proxy
in front of your application, scores every request against its rules, and blocks when the score crosses a
threshold you choose. This post explains why it exists, then follows one malicious request through the code,
from the socket to the 403.</p>

> **TL;DR**
>
> - **What:** a Layer-7 WAF and reverse proxy in Rust, with its own detection rules and a cumulative score
>   that explains every block, rule by rule.
> - **For whom:** teams that run their own infrastructure — a single VM, Docker, or Kubernetes — and want a
>   WAF they can read, tune and extend, without a SaaS or a commercial tier.
> - **Cost:** about 0.3 ms of added p99 latency and ~21 MiB of memory in our benchmark.
> - **Try it:** `git clone https://github.com/0x00spor3/Light-WAF && cd Light-WAF/demo && docker compose up`
> - **License:** Apache-2.0, everything included.

## Why another WAF

The reference open-source WAF is ModSecurity with the OWASP Core Rule Set. The rules are excellent and Light
WAF owes a lot to them — the cumulative anomaly score and the *paranoia levels* come straight from the CRS
(a paranoia level, from 1 to 4, decides how suspicious a pattern has to be before a rule for it is active:
higher levels catch more attacks and more legitimate traffic). But the engine is a C++ library from another
era, its original maintainer ended support in 2024, and anyone who has run it knows two recurring moments:

- **The unexplained block.** A customer cannot submit a form and the WAF says 403. Finding out which rule
  fired, on which field, after which decoding, means reading an audit log written for the engine.
- **The tuning tax.** To stop false positives you lower the paranoia level or disable a rule group, and you
  are never quite sure how much protection you just gave away.

The goals for Light WAF were:

- every decision explains itself, rule by rule, in a structured log;
- the trade-offs are settings, not hidden defaults — including what happens when the WAF itself fails;
- it is light enough to put in front of anything: one binary, one TOML file, no database.

### What about Coraza, and the others?

ModSecurity is not the only option, and if you know this space you are probably thinking of
[Coraza](https://coraza.io/): an OWASP project that reimplements the ModSecurity engine in Go, so the CRS
runs on a modern, memory-safe base and embeds in Caddy, Envoy or your own Go service. If running the CRS
unchanged is what you need, Coraza is the natural choice. There are also complete packages such as
BunkerWeb, which wraps nginx with ModSecurity and the CRS, and products with their own engines such as
SafeLine or open-appsec.

Light WAF makes a different bet, and it is the most important thing to know about it: **the protection
comes from its own native rules, not from the CRS.** About 85 regex rules plus a few structural checks,
written as Rust tables, each with an id, a pattern, a severity and a paranoia level, and each checked
against a corpus of attacks *and* of legitimate requests that look like attacks.

That buys three things: rules small enough to read in one sitting, a decision that names the exact rule
behind every point, and an engine that can be fast because it only has to run its own rule format. It
costs something too: the CRS has a decade of tuning against real traffic, and ours does not. You can load
`SecRule` files — including parts of the CRS — through a built-in parser, but it supports a subset of the
language, so it is a way to add rules, not a drop-in replacement for the CRS.

## The shape of the code

The core is six crates, each with one job:

| Crate | Job |
|---|---|
| `waf-core` | shared types: `Config`, `RequestContext`, `Decision`, the `WafModule` trait |
| `waf-normalizer` | decoding, Unicode normalization, parsing, defensive limits |
| `waf-detection` | the detection modules, their rule tables, and the fast-path prefilter |
| `waf-pipeline` | runs modules by phase, accumulates the score, decides the verdict |
| `waf-wasm` | a Proxy-Wasm runtime, so `.wasm` filters can act as modules |
| `waf-proxy` | the reverse proxy itself (`tokio`, `hyper` 1, `rustls` with `ring`) and the `waf` binary |

Everything that is not needed on a single node — the control plane, Redis-backed shared state, managed ACME
certificates, the Kubernetes operator — lives in separate crates that plug into the core through a builder.
The core never depends on them.

A detection module is a small trait:

```rust
pub trait WafModule: Send + Sync {
    fn id(&self) -> &str;
    fn phase(&self) -> Phase;
    /// Called once at startup; compile rules here, never in `inspect`.
    fn init(&mut self, cfg: &Config);
    /// Read-only access to the request; the pipeline owns the score.
    fn inspect(&self, ctx: &RequestContext) -> Decision;
    /// Structural modules (GraphQL, gRPC) run even when the fast path skips content rules.
    fn structural(&self) -> bool { false }
}
```

`inspect` takes `&RequestContext`. A module reports *what* it found; only the pipeline mutates the score.
That single choice shows up again further down, in panic isolation.

## Following one request

Here is the request we will follow. It is the XSS probe from the
[demo](https://github.com/0x00spor3/Light-WAF/tree/main/demo), at paranoia level 2 with a block threshold of 5:

```
GET /search?q=%3Cscript%3Ealert(document.cookie)%3C/script%3E HTTP/1.1
Host: shop.example
X-Forwarded-For: 203.0.113.7
```

### 1. Accept

The listener is `hyper-util`'s auto builder on `tokio`: HTTP/1.1 and cleartext HTTP/2 on the same port, or,
with TLS on, HTTP/1.1 and HTTP/2 negotiated by ALPN over `rustls`. TLS is the one place with no fail-open
option: with TLS enabled, an unreadable certificate stops the process at boot instead of silently serving
plaintext.

### 2. Who is asking

Rate limiting and logging need the real client address, and `X-Forwarded-For` is attacker-controlled. The
header is read only if the *peer* is in `trusted_proxies`, and then from the right: the address
`trusted_hops` positions from the end is taken, never the left-most one the client wrote. With
`trusted_proxies` empty — the default — the header is ignored entirely, so a deployment that nobody
configured cannot be spoofed. Our request comes from an untrusted peer, so its `X-Forwarded-For` is ignored.

### 3. Cheap checks first

The `Connection` phase runs **before** anything is parsed: the token-bucket rate limiter (in memory, or
cluster-wide over Redis when that component is plugged in) and request-smuggling validation (conflicting
`Content-Length` / `Transfer-Encoding` framing is rejected with a 400). A flood is turned away without
paying for normalization. Our request passes both.

### 4. Normalization

Rules are only as good as the input they see, and attackers encode. The normalizer first enforces the
defensive limits (body size, header count and size, number of parameters, JSON depth), then canonicalizes
every value:

```rust
/// Recursive percent-decode + overlong-collapse to a fixed point, consuming the
/// shared `budget`.
fn percent_overlong_fixpoint(
    raw: &[u8],
    plus_as_space: bool,
    budget: &mut usize,
) -> (Vec<u8>, usize) {
    let mut bytes = raw.to_vec();
    let mut passes = 0;
    while *budget > 0 {
        // `+` means space only on the first pass (form encoding).
        let decoded = percent_decode_bytes(&bytes, plus_as_space && passes == 0);
        let next = collapse_overlong(&decoded);
        if next == bytes {
            break;
        }
        bytes = next;
        passes += 1;
        *budget -= 1;
    }
    (bytes, passes)
}
```

Decoding repeats until the value stops changing, so `%253C` (double-encoded) ends up as `<` just like `%3C`.
Overlong UTF-8 forms such as `%C0%AE` are collapsed to the ASCII they smuggle. The budget is shared across
all decoding stages (`PIPELINE_CAP = 5`), so chaining encodings cannot make the normalizer loop. Then the
value goes through Unicode NFKC, which folds fullwidth `＜ｓｃｒｉｐｔ＞` and circled digits into plain ASCII.

The normalizer also *records* what it saw. Needing two or more passes sets a double-encoding flag; a NUL
byte in the path sets another, before the byte is stripped. A small structural module turns those flags
into score — we learned the hard way that a rule matching `\x00` cannot see a NUL that normalization
already removed.

Some content is encoded in a way that is not a canonical form of the same value — base64, HTML entities,
markup split in the middle of a keyword. For those there is a separate **derived channel**: the decoded
variant is matched against the rules and then discarded, never forwarded and never substituted for the
original. Base64 is only attempted on values that look like base64 and are at least 12 characters long.

Our query parameter `q` becomes `<script>alert(document.cookie)</script>`.

### 5. The fast path

Most requests are legitimate, and running every module on every request is wasted work. Before inspection,
a prefilter asks a narrower question: *could any content rule possibly match?*

It is built at startup from the same rule tables the modules use: one `regex::RegexSet` that is the union
of every active content pattern, scanned over a **superset** of the surfaces any rule inspects — path,
query, cookies, headers, body values, the derived channel and, for the NoSQL rules, the parameter *keys*.
If nothing in the set matches, no rule can match, and inspection is skipped with a guaranteed Allow.
Structural modules still run.

The important property is that the prefilter is **sound**: it may say "maybe" when the answer is no, but
never "no" when it is yes. That rules out the tempting shortcuts — a check for `<`, `'` or `%` would miss
`union select` written in plain letters. Soundness is also tested, not argued: the corpus test suite runs
every case through both the gated and the full path and requires identical verdicts.

Our request contains `<script`, so it is a candidate and goes to full inspection.

### 6. Inspection and scoring

Each module compiles its own rules into a `RegexSet` in `init`. On a request it collects every matching
rule across all the fields it inspects; a rule that matches in the query and in a cookie counts once, as in
the CRS. It returns `Decision::Scores` — rule ids with a severity, not points:

```rust
pub enum Decision {
    Allow,
    Block { rule_id: String, reason: String },
    Monitor { rule_id: String },
    Score { rule_id: String, points: u32 },
    Scores(Vec<ScoreItem>),               // { rule_id, severity }
    Reject { rule_id: String, reason: String, status: u16, retry_after: Option<u64> },
}
```

The pipeline maps severity to points from the config (critical 6, error 4, warning 3, notice 2 by
default) and adds them to the request's score. For our request the `xss` module matches three rules:

| Rule | Severity | Points |
|---|---|---|
| `xss-script-tag` | critical | 6 |
| `xss-js-sink-call` | warning | 3 |
| `xss-document-cookie` | warning | 3 |
| **Total** | | **12 ≥ 5 → blocked** |

The weights are tuned so that one high-confidence rule blocks on its own (6 ≥ 5) while a single weak
signal does not (3 < 5): a warning only blocks when something else agrees. Once the threshold is reached
the pipeline stops; the remaining modules do not run.

Every `inspect` call is wrapped in `catch_unwind`. A module that panics on some odd input is isolated and
the configured `on_internal_error` policy applies: skip that module, or block the request. This is where
the read-only `&RequestContext` pays off — a panicking module cannot leave the score half-updated, so
`AssertUnwindSafe` is actually sound here rather than a way to silence the compiler.

Regex performance is a security property in a WAF: a pattern that backtracks catastrophically is a denial
of service waiting for the right input. The `regex` crate guarantees linear-time matching and does not
support look-around or backreferences. That occasionally makes a rule harder to write — precision has to
come from structure, like requiring a `(` after `javascript:` instead of a negative look-ahead — but no
input can make a rule slow.

### 7. The verdict, and why

The request is answered with a 403 and never reaches the backend. The decision log — JSON through
`tracing` — carries the breakdown:

```json
"score_contributions": [
  {"module": "xss", "rule_id": "xss-script-tag",      "severity": "critical", "points": 6},
  {"module": "xss", "rule_id": "xss-js-sink-call",    "severity": "warning",  "points": 3},
  {"module": "xss", "rule_id": "xss-document-cookie", "severity": "warning",  "points": 3}
]
```

That breakdown is what the control plane shows next to the captured request in its dashboard. When the
blocked request is a legitimate one, you see which rule fired, on what, and how much it weighed, before you
decide what to change. Here is this very request in the demo dashboard, blocked with a score of 12:

<img src="/shots/dashboard-demo.gif" alt="The Light WAF dashboard: the traffic overview, the list of denied requests, and the XSS request from this post blocked with a score of 12 built from three rules (6 + 3 + 3), with the captured request and the fired alerts" width="1100" height="653" loading="lazy" style="width:100%;height:auto;border:1px solid var(--line);border-radius:var(--radius-sm);margin:1rem 0">


A clean request takes the same path, skips inspection at step 5, and is forwarded with `hyper`'s client.
If the backend is down or exceeds `upstream_timeout_ms`, the `on_upstream_error` policy decides between a
502 and a retryable 503.

## Around the request path

**Failure is a setting.** What should happen when the WAF itself is in trouble is a business decision, so
each scenario is explicit:

```toml
[resilience]
on_upstream_error = "fail_closed"  # backend down → 502
on_internal_error = "fail_open"    # a panicking module must not take the site down
on_config_error   = "fail_open"    # an invalid reload keeps the last good config
on_parser_limit   = "fail_closed"  # input it cannot normalize → 400
```

**Hot reload without dropping requests.** Everything derived from the config — modules, compiled rules,
the prefilter — is built into one `Reloadable` value behind `RwLock<Arc<Reloadable>>`. On `SIGHUP` the new
config is loaded and validated, the whole set is rebuilt off to the side, and only then is the `Arc`
swapped; the write lock is held for a pointer assignment. Requests already in flight finish on the `Arc`
they cloned. An invalid file is logged and the previous config keeps running.

**Extending without forking.** Embedders use `Proxy::builder(&config)` with `.add_module(…)`,
`.module_factory(…)` (re-run on every reload, so injected modules survive a `SIGHUP`), `.state_store(…)`
and a TLS certificate source. `.wasm` filters run on `wasmi`, a pure-Rust interpreter pinned to an exact
version, with an instance pool and per-request fuel and memory caps. Existing ModSecurity `SecRule` files
can be loaded through a built-in parser for a subset of the language, which reports at boot every
directive it does not support rather than skipping it silently.

**No `unsafe`.** There is no `unsafe` code in the workspace. That does not make the dependencies
infallible, but it keeps memory-safety bugs out of the code that parses hostile input.

## How it is tested

- **A validation corpus** of a few hundred labelled requests — attacks, and benign requests that look like
  attacks (`select` in a search box, `<b>` in a comment, `exp(2)` in a formula). Every change must keep
  zero misses and zero false positives on it, plus the fast-path equivalence described above.
- **Fuzzing**: nine `cargo-fuzz` targets over the decoders and parsers that see raw input — path, query,
  cookies, form and JSON bodies, multipart, the GraphQL lexer and the gRPC extractor — run with
  ClusterFuzzLite on every pull request and nightly.
- **Real attacks**: before 1.0 we put the WAF in front of OWASP Juice Shop and DVWA and attacked it. What
  got through and how it was fixed is the subject of the next post.

## What it costs

From the [reproducible benchmark](/benchmarks): one machine, the same nginx backend, each WAF pinned to the
same two CPU cores. ModSecurity is the official `owasp/modsecurity-crs` image (CRS 4, nginx), configured
through its documented environment variables with response inspection off, as Light WAF does not inspect
responses. Both at paranoia level 2 with a threshold of 5:

| | Light WAF | ModSecurity + CRS |
|---|---|---|
| p99 latency, clean GET at 250 req/s | 0.57 ms | 3.81 ms |
| Max throughput, clean GET | 14,055 req/s | 800 req/s |
| Memory under load | 21 MiB | 103 MiB |
| gotestwaf attacks blocked | 76% | 55% |
| gotestwaf legitimate requests passed | 100% | 65% |

Without a WAF the same p99 is 0.27 ms, so Light WAF adds about 0.3 ms at that load. At paranoia level 1
ModSecurity lets 91% of the legitimate requests through but blocks 49% of the attacks. Light WAF's strict
profile blocks 96% of the attack set, still with no false positives.

A gap that large deserves suspicion, so the whole setup is in the repository: the compose file, the
configs, the load generator and a single script that reruns it. One machine and one test suite are not a
guarantee for your traffic; the [benchmark page](/benchmarks) lists the hardware, the image digests, the
per-category results and the gaps that are still open.

## What it is not (yet)

- **Not a CDN or a volumetric DDoS shield.** It is a Layer-7 proxy: it rate-limits and rejects abuse, but
  it will not absorb a flood in front of your network.
- **No per-rule exclusions yet.** You can switch whole modules off and tune the paranoia level, threshold
  and severity weights, but you cannot yet say "ignore this rule on this endpoint". It is the next thing a
  production user asks for, and it is on the list.
- **Paranoia level 4 is reserved.** Rules exist at levels 1 to 3; level 4 is accepted and currently adds
  no rules. The strict profile gets its extra recall from a lower threshold.
- **Young.** 1.0 shipped in October 2026. The detection has been through the corpus, fuzzing and real
  pentests, but it has not met the variety of production traffic that the CRS has seen over a decade.
  That is the feedback we are looking for.

Beyond the core, the same repository has a control plane (dashboard, alerting, SSO, a signed audit log,
SIEM export), cluster-wide rate limiting over Redis, managed ACME certificates, Helm charts and a
Kubernetes operator — all opt-in and all Apache-2.0, with no enterprise edition.

## Try it

The demo runs the WAF, the dashboard and a stream of attacks from the release images, and needs only
Docker:

```sh
git clone https://github.com/0x00spor3/Light-WAF && cd Light-WAF/demo && docker compose up
```

Open <http://localhost:9600> (`admin` / `lightwaf-demo`) and the request from this post is in the event
list, with its three rules. To run it in front of your own application, see the
[quick start](/docs/quickstart); the core crates are on [crates.io](https://crates.io/crates/waf-proxy).

## Get involved

A word on "we": Light WAF is maintained by one person for now. That is the main reason contributions
matter — reviews, reports and code from other people are what turn it from my project into a project.

- Questions and ideas: [GitHub Discussions](https://github.com/0x00spor3/Light-WAF/discussions).
- A legitimate request blocked? Open a
  [false-positive issue](https://github.com/0x00spor3/Light-WAF/issues/new/choose) — they are among the most
  useful reports we get.
- Want to write some Rust? The
  [good first issues](https://github.com/0x00spor3/Light-WAF/labels/good%20first%20issue) say which files to
  touch and how to test the change.
- Found a request that gets through? Please report it privately, as described in
  [SECURITY.md](https://github.com/0x00spor3/Light-WAF/blob/main/SECURITY.md).
