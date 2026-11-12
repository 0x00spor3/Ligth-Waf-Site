---
layout: ../../layouts/BlogLayout.astro
title: "Light WAF 1.0.3: the bodies we did not inspect"
description: "1.0.3 is a security release. Malformed multipart framing, or one invalid UTF-8 byte, kept a whole request body out of inspection. What went wrong, how it was fixed without blocking real uploads, and what else is in the release."
date: "2026-11-12"
author: "0x00spor3"
---

<!-- SPDX-FileCopyrightText: 2026 0x00spor3
     SPDX-License-Identifier: Apache-2.0 -->

# Light WAF 1.0.3: the bodies we did not inspect

<p class="lede">1.0.3 is a security release. Some request bodies were not inspected at all, so an
attack inside them reached the application whichever detection module should have caught it. If you
rely on Light WAF to inspect request bodies, upgrade.</p>

> **Advisory:** [GHSA-v585-4mp9-ggfh](https://github.com/0x00spor3/Light-WAF/security/advisories/GHSA-v585-4mp9-ggfh) ·
> affected: every release up to 1.0.2 · fixed in 1.0.3. Query strings, paths and headers were not affected.

## How it was found

Our [benchmark](/benchmarks) had one result we could not explain. gotestwaf's two
`community-lfi-multipart` cases passed even on the strict profile, while the same payloads were blocked
in a query string. ModSecurity + CRS blocked both. We listed it as an open LFI gap in
[our pentest post](/blog/attacking-our-own-waf) and asked for help.

It was not an LFI gap. The path traversal rules never saw the payload, because the body it was in was
never handed to any rule.

## What went wrong

A WAF and the application behind it have to read a request the same way. Where they disagree, an
attacker can write a request that the WAF reads as harmless and the application reads as an attack.
That is what happened, in three places:

- **multipart/form-data.** Our parser required strict CRLF line endings and exact delimiters, and it
  stopped quietly at the first deviation, handing the modules no fields. PHP, among others, accepts bare
  LF and other loose shapes, and reads the fields anyway. A field value with one invalid UTF-8 byte was
  also skipped, as if it were a binary file.
- **application/x-www-form-urlencoded.** The body was decoded strictly as UTF-8. One invalid byte
  anywhere made the whole form yield no parameters. Backends split on `&` and `=` whatever the bytes
  are, so they still read every parameter.
- **Raw bodies** such as `text/plain` or XML. A body that was not valid UTF-8, or contained a NUL,
  was not inspected. That also covered XML sent as UTF-16.

The part worth being honest about is why our tests did not catch it. The detection corpus builds
multipart bodies with a helper, and the helper always wrote clean CRLF framing. Every multipart test
passed, because every multipart test sent the one shape the parser handled. One property-based test even
asserted that a form with an invalid byte must come out empty: "no partial parse" was meant as a
safety property, and it pinned the bypass in place.

## How it is fixed

The rule we followed: the WAF must not see less than the application does. Throwing input away is
never the safe default.

- **Multipart** is parsed the way backends parse it: bare LF, padding after delimiters, quoted
  parameters, `filename*`, quoted-printable parts. Any body that departs from what browsers and HTTP
  clients send is *also* scanned as a whole, so a shape we do not parse still gets inspected. Line breaks
  in that whole-body text are replaced by a separator that is not whitespace, so a rule cannot match
  across two unrelated lines.
- **Forms** are decoded lossily: an invalid byte becomes a replacement character, and every parameter is
  kept.
- **Raw bodies** are read as text when they declare a text type (`text/*`, JSON, XML, YAML, GraphQL,
  JavaScript), whatever bytes they contain. For any other type, the content decides, because the client
  chooses the Content-Type: a body that is nearly all text is inspected. NULs are dropped first, which
  also makes ASCII in UTF-16 readable.

The risk on the other side is blocking real uploads. A binary file is full of bytes that happen to spell
`<script` or `../` somewhere. So binary file uploads in multipart stay out of the scan, as do bodies
under a `Content-Encoding` and gRPC. For raw bodies, "nearly all text" means fewer than 5% non-text
bytes. We picked the threshold by sending 690 real binary files from a Windows disk (images,
executables, archives, databases) as raw bodies: at the default profile 1.0.3 blocks exactly the same 3
files 1.0.2 did, and at the strict profile one more.

## How we checked it

- **On exact bytes.** The corpus can now send a body byte for byte, so it no longer depends on a helper
  that writes clean framing: 32 multipart attacks and 7 benign traps, 12 attacks and 6 benign cases for
  forms and raw bodies, against the real binary in both profiles.
- **Differentially.** Every payload in the corpus is replayed inside malformed multipart in three shapes
  (bare LF, an invalid byte, a mismatched boundary). It must still be caught, and every benign value must
  still pass.
- **Property tests and fuzzing.** The form invariant is now "the form parses exactly like its lossy
  text", in a proptest and in the fuzz target. A well-formed multipart body must parse to exactly the
  fields it was built from.
- **gotestwaf.** No legitimate request is blocked, on either profile.

## Benchmark

From the [benchmark](/benchmarks), rerun on 1.0.3 on the same machine as the 1.0.1 run:

| | 1.0.1 | 1.0.3 |
|---|---|---|
| `community-lfi-multipart`, default and strict | 0/2 | 2/2 |
| gotestwaf attacks blocked, default (PL2) | 76.44% | 76.74% |
| gotestwaf attacks blocked, strict (PL4) | 96.00% | 96.30% |
| gotestwaf legitimate requests passed | 100% | 100% |
| added p99, clean GET at 250 req/s | 0.30 ms | 0.29 ms |

The extra inspection costs nothing measurable on normal traffic: well-formed bodies take the same path
as before.

## What is still open

- A body under a non-text Content-Type, padded with enough binary data to look binary, is still not
  scanned. It only matters for a backend that reads such a body as text whatever its declared type, and
  closing it would mean scanning real binaries.
- In whole-body scanning, a payload that depends on line breaks (some mail-header injections) is caught
  only when the parser can extract the field.
- RFC 2231 parameter continuations and UTF-16 inside multipart parts are not decoded.

## Also in 1.0.3

- **Slack and Mattermost alerts.** `webhook_format = "slack"` posts fired alerts as the `{"text": …}`
  those webhooks expect. See [Control plane](/docs/control-plane).
- **CEF export to SIEMs**, next to the ECS-like NDJSON, with a tested Vector pipeline for syslog. See
  [Compliance & SIEM](/docs/compliance-siem).
- A failed alert delivery no longer writes the webhook URL to the control-plane log. A Slack URL is a
  credential: if you use one, check your logs and rotate it if it appears there.
- SIEM export: `source.ip` now holds only IP addresses.
- The operator moved to kube 4.2 and needs Kubernetes 1.32 or later.

The full list is in the [CHANGELOG](https://github.com/0x00spor3/Light-WAF/blob/main/CHANGELOG.md).

## Upgrading

```sh
cargo install waf-proxy --version 1.0.3      # or bump the crates you depend on
docker pull ghcr.io/0x00spor3/waf-enterprise:1.0.3
helm upgrade myapp-waf oci://ghcr.io/0x00spor3/charts/waf --version 1.0.3
```

Images, charts and release assets are signed; [the docs](/docs) show how to verify them. One behaviour
change to expect: a client that sends malformed multipart, or bodies with invalid bytes, may now see
rules fire on content that was not inspected before. That is the point of the release, but if a
legitimate client of yours does it, run in detection-only mode first and check the log.

Found a request that gets through? Please report it privately through
[GitHub security advisories](https://github.com/0x00spor3/Light-WAF/security/advisories/new).
