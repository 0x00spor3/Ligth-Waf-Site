---
layout: ../../layouts/BlogLayout.astro
title: "We attacked our own WAF: 12 bypasses and what fixed them"
description: "Four pentest rounds against Light WAF with OWASP Juice Shop and DVWA behind it: the payloads that got through, why they got through, how each was fixed, and the gaps that are still open."
date: "2026-10-30"
author: "0x00spor3"
---

<!-- SPDX-FileCopyrightText: 2026 0x00spor3
     SPDX-License-Identifier: Apache-2.0 -->

# We attacked our own WAF: 12 bypasses and what fixed them

<p class="lede">A WAF that has only been tested by the people who wrote its rules has not been tested. Before 1.0 we put
Light WAF in front of two deliberately vulnerable applications and attacked it for real. This is what got
through, why, and how each hole was closed — plus the ones that are still open.</p>

> **All the bypasses below were found in the 0.5.x releases and fixed before 1.0.0.** The current release
> is 1.0.2. New to Light WAF? [Why we built Light WAF](/blog/why-light-waf) explains how it scores and
> blocks requests, which helps with the details here.

## The setup

Two well-known vulnerable apps sat behind the WAF in blocking mode, so a request that the WAF let through
actually reached code that could be exploited:

- **[OWASP Juice Shop](https://owasp.org/www-project-juice-shop/)** (Node.js, SQLite) — three rounds:
  a broad first pass, an advanced round with encoding evasion, and an "extreme" round that looked for
  leaked data in every response body, not just the status code.
- **[DVWA](https://github.com/digininja/DVWA)** at `security=low` (PHP, MariaDB), logged in, at paranoia
  level 3.

Each round sent between 45 and 90 hand-written payloads across SQLi, XSS, command injection, LFI/RFI,
SSRF, SSTI, NoSQL, LDAP, XXE, header injection and scanner signatures, plus clean baseline requests to
catch false positives.

The large majority was blocked from the first round: plain and stacked SQLi, every XSS vector we tried,
command injection, path traversal including double and overlong encodings, PHP wrappers, cloud-metadata
SSRF. What follows are the exceptions.

Every fix went through the same gate: a test that fails first, the fix, the payload added to the
[detection corpus](https://github.com/0x00spor3/Light-WAF/tree/main/crates/waf-corpus) next to benign
look-alikes, and a full corpus run that must show no new misses and no new false positives. Each round
also has a regression test that replays its payloads:
[`juiceshop_report_regression.rs`](https://github.com/0x00spor3/Light-WAF/blob/main/crates/waf-corpus/tests/juiceshop_report_regression.rs),
[`extreme_report_regression.rs`](https://github.com/0x00spor3/Light-WAF/blob/main/crates/waf-corpus/tests/extreme_report_regression.rs),
[`dvwa_report_regression.rs`](https://github.com/0x00spor3/Light-WAF/blob/main/crates/waf-corpus/tests/dvwa_report_regression.rs).

## The two that leaked real data

### `UNION/**/SELECT` dumped the users table

```
GET /rest/products/search?q=qwert')) UNION/**/SELECT id,email,password,... FROM Users--
```

`UNION SELECT` was blocked. `UNION/**/SELECT` returned **200 with the users table**, admin password
hash included. SQLite treats an empty block comment as whitespace, so the query was valid; the rule
looked for `union\s+select` and a comment is not `\s`.

**Fix.** The SQLi module now also matches against a copy of the input where every `/* … */` block is
collapsed to a single space — the equivalent of CRS's `t:replaceComments`, but scoped to the SQLi
module only, so JSON or prose containing `/*` elsewhere is not rewritten. Two details mattered:

- MySQL *versioned* comments (`/*!50000UNION*/`) execute their content. Collapsing them to a space
  would have hidden a keyword that was already caught, so a test pins that they still block.
- The prefilter that lets clean requests skip the expensive rules had to test the collapsed form too.
  Otherwise the fix would have worked in unit tests and been skipped in production.

A comment *inside* a keyword (`UN/**/ION`) still passes — it collapses to invalid SQL and returns an
error, not data.

### Error-based SQLi with `extractvalue()` on DVWA

```
?id=1' AND extractvalue(1,concat(0x7e,(SELECT concat(user,0x3a,password) FROM users)))-- -
```

MariaDB answered with an XPath error containing `~admin:5f4dcc3b5aa765…` — the admin hash, 32
characters at a time. No `UNION`, no `OR 1=1`, no comment: just a function call in an `AND`. The SQLi
rules had no token for the error-based functions.

**Fix.** Three critical rules: `extractvalue(` / `updatexml(`, `exp(~` (the double-overflow trick), and
`exists(select`. False-positive traps went into the corpus alongside them — `exp(2)` in a formula, the
word *exists* in prose, documentation that mentions `extractValue` — and stay clean.

## Encoding: the normalizer was too good

```
GET /ftp/package.json.bak%2500.md
```

`%2500` is a double-encoded NUL byte. Juice Shop refuses `.bak` files, but this request returned the
file. The interesting part was the root cause: the normalizer *did* decode it — to a fixed point — and
then stripped the NUL, as it should. The path the rules saw was a clean `/ftp/package.json.bak.md`.
There was a `pt-null-byte` rule, and a comment in the code next to it said it was dead on the path for
exactly this reason. A rule that matches `\x00` cannot see what normalization already removed.

**Fix.** The normalizer now records *that* it found a NUL (before stripping it) and that it had to
decode more than once. A small structural module turns those flags into score: a NUL byte is critical,
double encoding is a warning (some legacy proxies re-encode, so on its own it must not block). The
point was as much the log as the block: before, the request left no trace at all.

## Coverage gaps: the payload was right, the rule did not know it

These did not leak anything against Node or PHP, but would be remote code execution or authentication
bypass on another stack — so they count.

| Payload | Why it passed | Fix |
|---|---|---|
| `<%=7*7%>` (ERB/EJS/JSP) | the SSTI arithmetic rule knew `{{`, `${`, `#{` — not `<%` | `ssti-erb-jsp-arithmetic`: the delimiter plus *adjacent* digit-operator-digit, so `<%= user.name %>` stays clean |
| `() { :;}; …` in `User-Agent` | no Shellshock signature, and the User-Agent was excluded from content scanning | `rce-shellshock`, boundary-anchored so JavaScript `function(){` does not match, with a dedicated User-Agent scan |
| `{{config.items()}}`, `{{''.__class__.__mro__}}` | Jinja object access, not arithmetic | `ssti-python-dunder`, `ssti-jinja-object`, `ssti-template-statement` |
| `{"email":{"$gt":""},"password":{"$gt":""}}` | MongoDB operators live in the *key*, and keys were not scanned | `nosql-operator-key` on parameter names and JSON/form keys |
| `{"__proto__":{…}}` | same blind spot: prototype pollution is a key | `proto-pollution-key`, keys only — `obj.__proto__` as a value stays clean |
| `OR 1 LIKE 1`, `OR 1<2`, `OR 0x1=0x1` | the tautology rule only knew `=` with integers or single characters | comparisons and `LIKE` with numeric operands; `a<b or c>d` in prose stays clean |
| `*{7*7}`, `@(1+2)`, `{%print(7*7)%}`, `{php}` | Thymeleaf, Razor, Jinja without a space, Smarty | delimiters added to the SSTI rules, plus `ssti-smarty-php` |
| `${${lower:j}ndi:…}`, `${::-j}${::-n}di` | Log4Shell lookups that rebuild `jndi` at runtime | a curated CRS rule that matches the obfuscation primitives instead of the word |

## A regex that could never match

```
http://[::1]/admin
```

The SSRF loopback rule had an alternative for `[::1]`. It had never fired. The group was wrapped in
`\b…\b`, and a word boundary needs a word character on one side: `[` and `]` are not word characters,
so `\b\[` can never match at the start of a bracket. The branch was dead code from the day it was
written, and the unit tests had only covered IPv4.

**Fix.** A dedicated alternative anchored on the literal brackets, covering `[::1]`, `[0:0:0:0:0:0:0:1]`
and partial forms, while rejecting public addresses like `[2001:db8::1]`.

## The bypasses that were not

Some "bypasses" from the reports were artefacts of the test harness, and checking them was as
important as fixing the real ones:

- `http://①②⑦.0.0.1/` returned 200 — but Git Bash on Windows had turned the circled digits into `?`
  before curl sent them. Sent correctly, NFKC normalization folds them to `127.0.0.1` and the request
  is blocked. A unit test now pins that.
- `?q=<%=7*7%>` sent raw is malformed percent-encoding (`%=`); the WAF rejected it with a 400 before
  scoring. Encoded properly, it is a 403.
- A null byte in the query string looked like a pass because the shell had truncated it.

## Trade-offs we kept

Not every finding became a rule:

- **Bare remote URLs in parameters** (`page=http://evil/shell.txt`) score only a notice at paranoia
  level 3. URLs in parameters are everywhere — redirects, webhooks, profile links. A remote URL with
  an executable extension (`.php`, `.jsp`, …) is still blocked.
- **`127.0.0.1` as a value** is scored as SSRF, which blocked DVWA's own "ping a host" form. A
  loopback address in user input is a strong SSRF indicator, so the rule stays. Per-rule exclusions,
  to allow it on one endpoint only, are not there yet.
- **Blind SQLi by inference** (`ascii(substring(user(),1,1))>64`) is out of scope for signatures: the
  patterns are too close to normal expressions, and a rule tight enough to avoid false positives
  would be trivial to rephrase.

## Still open

- **LFI inside multipart form fields.** In the [gotestwaf benchmark](/benchmarks), two
  `community-lfi-multipart` cases (`/static/img/../../etc/passwd` and a UNC path) pass even on the
  strict profile, while the same payloads are blocked in a query string. It is
  [an open issue](https://github.com/0x00spor3/Light-WAF/labels/help%20wanted), and help is welcome.
- **The default profile is deliberately conservative.** With the benchmark's default profile
  (paranoia level 2, threshold 5) Light WAF blocks 76% of gotestwaf's attack set with no false
  positives; the strict profile (paranoia level 4, threshold 3) blocks 96%, also with none. Where you sit between the two is a choice, and the
  [benchmark page](/benchmarks) has the per-category numbers for both, next to ModSecurity + CRS.

## What we took away

- **Verify the root cause in the code, not in the report.** Two of the reports' guesses were wrong
  (the null byte was not a decoding gap; the homoglyph was not a bypass). Fixing the guessed cause
  would have shipped a rule that tests the wrong path.
- **A test must fail when the protected path breaks.** The `[::1]` branch had a test-shaped hole for
  months. Every fix here started from a test that failed first.
- **Every fix lands with its false-positive traps.** A rule for `exp(~` is worthless if it also
  blocks `exp(2)`. The corpus keeps both, forever.

If you find a request that gets through, please report it privately through
[GitHub's vulnerability reporting](https://github.com/0x00spor3/Light-WAF/security/advisories/new) —
see [SECURITY.md](https://github.com/0x00spor3/Light-WAF/blob/main/SECURITY.md). If a legitimate
request is blocked, open a
[false-positive issue](https://github.com/0x00spor3/Light-WAF/issues/new/choose). Both make the rules
better for everyone.
