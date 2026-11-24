---
layout: ../../layouts/BlogLayout.astro
title: "Light WAF 1.0.4: SQL injection that read as harmless"
description: "1.0.4 is a security release. Some SQL tautologies and UNION queries were missed by the native SQL injection module at every paranoia level. What was missed, how it was fixed, and what else is in the release: alert evidence and alert links in the control plane."
date: "2026-11-24"
author: "0x00spor3"
---

<!-- SPDX-FileCopyrightText: 2026 0x00spor3
     SPDX-License-Identifier: Apache-2.0 -->

# Light WAF 1.0.4: SQL injection that read as harmless

<p class="lede">1.0.4 is a security release. The native SQL injection module missed some forms of
tautology and of UNION query, so those attacks reached the application at every paranoia level. If you
rely on Light WAF's native SQLi detection, upgrade.</p>

> **Affected:** every release up to 1.0.3 · **fixed in 1.0.4.** Only the native `sqli` module is
> concerned; the other modules and the curated CRS content are unchanged.

## What was missed

An injection does not have to look like the textbook example. SQL has many ways to write the same
condition and the same query, and a rule that knows only the common spelling lets the others through.
We went looking for syntactic equivalents that our normalizer does not fold back to one form, and found
two families the rules did not cover:

- **Tautologies with string operands, and `BETWEEN`.** The tautology rules caught the numeric forms
  (`OR 1=1` and its relatives) but not every comparison between strings, nor a `BETWEEN` predicate used
  in injection context. Both make a `WHERE` clause always true just as well.
- **UNION queries with an alternative separator or a set modifier.** `sqli-union-select` expected
  `UNION` and `SELECT` separated in the usual way. Databases accept other separators between the two
  keywords, and a set modifier in between, and run the same query.

In both cases the request scored below the block threshold, at every paranoia level.

## How it is fixed

- `sqli-tautology-or` (and `sqli-tautology-and` at PL2 and above) now recognise tautologies with
  string operands and the `BETWEEN` predicate in injection context.
- `sqli-union-select` now recognises UNION queries with an alternative separator or set modifier.

Rule ids, severities and paranoia levels are unchanged, so scores, thresholds and any exclusions you
wrote against these rules keep working. The patterns stay on the linear-time `regex` engine, and the
prefilter is built from the same rule tables, so the fast path widened with them.

## How we checked it

- **Corpus.** 25 new attack cases and 18 new benign traps, run through the real normalizer and
  pipeline. Every widened part of a pattern has a trap next to it: ordinary text that uses the same
  words must stay clean: "rooms for 2 or 3 between 100 and 200 euros", `O'Brien or D'Angelo`,
  `"red shoes" OR "blue shoes"`, "credit union (select branch)".
- **gotestwaf.** No legitimate request is blocked, on either profile.

## Benchmark

From the [benchmark](/benchmarks), rerun on the 1.0.4 image on the same machine as the 1.0.3 run:

| | 1.0.3 | 1.0.4 |
|---|---|---|
| gotestwaf attacks blocked, default (PL2) | 76.74% | 76.74% |
| gotestwaf attacks blocked, strict (PL4) | 96.30% | 96.30% |
| gotestwaf legitimate requests passed | 100% | 100% |
| added p99, clean GET at 250 req/s, default | 0.29 ms | 0.40 ms |
| added p99, clean GET at 250 req/s, strict | 0.32 ms | 0.27 ms |

gotestwaf did not move, per test case either: these SQL forms are not in its set, which is also why the
benchmark never showed the gap. The latency rows moved in opposite directions on the two profiles,
which run the same binary. At a tenth of a millisecond, that is run-to-run noise, not a cost of the
new patterns.

## Also in 1.0.4

- **Alert evidence.** Open a fired alert in the dashboard and you get the denied events that made it
  fire (its window, its rule's filters and the group that fired), each linking to the drill-down, and
  whether the alert is still ongoing. Each alert keeps a snapshot of its rule's match, so the events
  stay resolvable after you edit the rule. New `GET /api/alerts/{id}` and `GET /api/alerts/{id}/events`.
- **Alert links.** Set `[controlplane].public_url` and every alert links to its dashboard page: in the
  `generic` webhook body, at the end of the Slack/Mattermost text, and in the SIEM alert event. SIEM
  alert events also carry up to 5 `request_id`s of the events behind them, to correlate with the
  decision stream. See [Control plane](/docs/control-plane) and [Compliance & SIEM](/docs/compliance-siem).
- **A time range on Events**, in the dashboard and as `since` / `until` on `GET /api/events`.
- **Curated CRS content** covers the Aug–Nov 2026 KEV wave: 13 new rules, 41 in all, behind a new
  false-positive gate.
- **The operator moved to kube 5.0** and now needs Kubernetes 1.33 or later (1.37 is covered).
- Dependency updates that clear the OSV-Scanner and Scorecard findings. None of them affected Light WAF:
  the code involved was never built or never called.

The full list is in the [CHANGELOG](https://github.com/0x00spor3/Light-WAF/blob/main/CHANGELOG.md).

## Upgrading

```sh
cargo install waf-proxy --version 1.0.4      # or bump the crates you depend on
docker pull ghcr.io/0x00spor3/waf-enterprise:1.0.4
helm upgrade myapp-waf oci://ghcr.io/0x00spor3/charts/waf --version 1.0.4
```

Images, charts and release assets are signed; [the docs](/docs) show how to verify them. Two things to
check:

- **Detection.** A client that sends SQL-like text in parameters may now see `sqli-tautology-*` or
  `sqli-union-select` fire where it did not before. If you are unsure, run in detection-only mode first
  and check the log.
- **Postgres URL.** `sqlx` 0.9.1 follows libpq: `hostaddr` (`PGHOSTADDR`) is no longer an alias of
  `host`, it skips DNS while `host` is still used for TLS SNI. If your `WAF_CP_DATABASE_URL` relied on
  the old alias, use `host` instead. This applies to the control plane, governance and the node agent.

The control plane applies its new migration (`0008_alert_match`) at boot. Alerts fired before the
upgrade use the configured rule of the same name to find their events, or report them unavailable.

Found a request that gets through? Please report it privately through
[GitHub security advisories](https://github.com/0x00spor3/Light-WAF/security/advisories/new).
