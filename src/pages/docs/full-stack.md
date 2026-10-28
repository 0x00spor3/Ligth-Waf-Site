---
layout: ../../layouts/DocsLayout.astro
title: "Full stack"
description: "Run the whole Light WAF stack locally — the waf-enterprise proxy, the control plane with its dashboard on Postgres, and the node agent — from source or from the container images."
---

<!-- SPDX-FileCopyrightText: 2026 0x00spor3
     SPDX-License-Identifier: Apache-2.0 -->

# Full stack

<p class="lede">Get all three services running locally: the WAF proxy with the at-scale components, the control plane with its dashboard, and the node agent. Production hardening (TLS, secrets, systemd or Kubernetes) is layered on in the other chapters.</p>

> **Just want to see it?** The repository's
> [demo](https://github.com/0x00spor3/Light-WAF/tree/main/demo) runs the whole stack — with demo
> traffic and attacks already flowing — from the release images, in one command (needs only Docker):
>
> ```sh
> git clone https://github.com/0x00spor3/Light-WAF && cd Light-WAF/demo && docker compose up
> ```
>
> Then open <http://localhost:9600> (`admin` / `lightwaf-demo`). The rest of this page sets the
> services up one by one, the way you would for a real deployment.

## Prerequisites

- **Rust** (stable) to build from source — one Cargo workspace, built from the repository root.
  Or use the [container images](/docs#container-images) instead.
- **Node 22 / npm 10** — only to build the dashboard from source.
- **Postgres 16** — only for the control plane.
- **Redis 7** — only if you enable cluster-wide rate limiting or IP reputation.

None of these are required by the WAF proxy itself: a standalone WAF needs only the binary.

## Ports at a glance

| Service | Default port | Purpose |
|---|---|---|
| WAF proxy | `8080` | client traffic (the data path) |
| WAF proxy `/metrics` | `9090`* | Prometheus scrape (config-dependent) |
| Control plane | `9600` | dashboard + read/ingest API |
| Postgres | `5432` | control-plane storage |
| Redis | `6379` | distributed state (optional) |

\* The metrics endpoint address is part of the proxy config; point the control plane's scraper at it.

## 1 · Run the WAF proxy

The proxy binary is `waf-enterprise`. It reads the same config file as the core `waf` binary plus
the `[enterprise.*]` tables. Start from the sample
[`examples/enterprise.toml`](https://github.com/0x00spor3/Light-WAF/blob/main/examples/enterprise.toml)
(from the repository root):

```sh
cargo run --release -p waf-enterprise -- --config examples/enterprise.toml
# or: cargo install waf-enterprise && waf-enterprise --config enterprise.toml
```

At minimum the config needs a listener and a backend:

```toml
[proxy]
listen  = "0.0.0.0:8080"
backend = "http://127.0.0.1:8000"

[waf]
mode = "blocking"
block_threshold = 5
```

Send a request through it — a benign one is forwarded, an obvious attack is blocked:

```sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/                       # 200
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8080/?q=1'+OR+'1'='1"      # 403
```

The full configuration is in [Configuration](/docs/configuration) and
[At-scale components](/docs/components). The proxy runs fine on its own; add the services below when
you want a dashboard and governance.

## 2 · Run the control plane

The control plane is a **separate service** and never listens on the WAF data port. It needs
Postgres; it applies its schema migrations automatically at boot.

```sh
# a Postgres to talk to
docker run -d --name waf-cp-pg -p 5432:5432 -e POSTGRES_PASSWORD=pw postgres:16

# build the dashboard into the binary, then run it
cd crates/waf-controlplane/ui && npm ci && npm run build && cd ..
cargo build --release --features embed-ui

WAF_CP_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres \
WAF_CP_API_TOKEN=change-me \
  ../../target/release/waf-controlplane controlplane.toml
```

Or run the image, which has the dashboard embedded. It reads `/etc/waf/controlplane.toml`, so mount
a config that listens on all interfaces inside the container (`host.docker.internal` reaches the
Postgres published on the Docker host):

```sh
cat > controlplane.toml <<'EOF'
[controlplane]
listen = "0.0.0.0:9600"
EOF

docker run --rm -p 9600:9600 \
  -v "$PWD/controlplane.toml:/etc/waf/controlplane.toml:ro" \
  -e WAF_CP_DATABASE_URL=postgres://postgres:pw@host.docker.internal:5432/postgres \
  -e WAF_CP_API_TOKEN=change-me \
  ghcr.io/0x00spor3/waf-controlplane:1.0.1
```

Open <http://localhost:9600>. With no governance configured you'll be asked for the bearer token
(`WAF_CP_API_TOKEN`); paste it and you land on the dashboard.

To point the WAF at the control plane, feed it telemetry two ways (either or both):

- **Push** the decision log: ship the WAF's structured JSON decision-log lines to
  `POST /ingest/events?node=<name>` as an NDJSON batch (any log shipper).
- **Pull** metrics: list the node under `[[controlplane.nodes]]` so the scraper polls its
  `/metrics`.

See [Control plane](/docs/control-plane) for the dashboard tour and the config reference.

### Building without the embedded UI

A plain `cargo build --release` (feature off) produces a control plane that serves the API but no UI
— useful for headless/API-only deploys. For local UI development, run `npm run dev` in `ui/` (it
proxies `/api` to a control plane on `:9600`) or point `[controlplane].ui_dir` at `ui/dist`.

## 3 · Run the node agent (optional)

The node agent is only needed for **governed rule management** ([Rule management](/docs/rule-management)).
One runs on each WAF node. It pulls the current published ruleset from the control plane and writes
it to the file the WAF loads.

```sh
WAF_AGENT_TOKEN=<a control-plane service token> \
  cargo run --release -p waf-node-agent -- node-agent.toml
```

Its config ([`node-agent.toml`](https://github.com/0x00spor3/Light-WAF/blob/main/crates/waf-node-agent/node-agent.toml))
points at the control plane, names this node, and declares the managed file — which **must** be the
same path the WAF loads via `[modules.crs].files`:

```toml
[agent]
control_plane_url = "http://127.0.0.1:9600"
node_name         = "edge-1"
managed_file      = "/etc/waf/managed.conf"   # also in the WAF's [modules.crs].files
reload_command    = "kill -HUP $(cat /run/waf.pid)"
poll_interval_seconds = 15
```

## Where to go next

- Tune detection and enable the components → [Configuration](/docs/configuration), [At-scale components](/docs/components)
- Learn the dashboard and alerting → [Control plane](/docs/control-plane)
- Turn on users, roles and SSO → [Governance](/docs/governance)
- Deploy on a cluster → [Kubernetes](/docs/kubernetes)
