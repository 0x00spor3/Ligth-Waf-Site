// SPDX-FileCopyrightText: 2026 0x00spor3
// SPDX-License-Identifier: Apache-2.0
// Shared site constants. Light WAF is one open-source repository (Apache-2.0): the core and the
// at-scale components live in the same workspace and ship on the same version.

export const VERSION = "1.0.2";

export const REPO = "https://github.com/0x00spor3/Light-WAF";
/** A file on the default branch of the repository. */
export const repoFile = (path: string) => `${REPO}/blob/main/${path}`;

/** Release history. */
export const RELEASES = `${REPO}/releases`;
export const CHANGELOG = repoFile("CHANGELOG.md");
export const CONTRIBUTING = repoFile("CONTRIBUTING.md");
export const CODE_OF_CONDUCT = repoFile("CODE_OF_CONDUCT.md");
export const SECURITY_POLICY = repoFile("SECURITY.md");
export const LICENSE = repoFile("LICENSE");
export const ISSUES = `${REPO}/issues`;
export const SECURITY_ADVISORY = `${REPO}/security/advisories/new`;
/** OpenSSF Scorecard: the repository's supply-chain grade, and its badge. */
export const SCORECARD = "https://scorecard.dev/viewer/?uri=github.com/0x00spor3/Light-WAF";
export const SCORECARD_BADGE = "https://api.scorecard.dev/projects/github.com/0x00spor3/Light-WAF/badge";
/** OpenSSF Best Practices: the project's self-certification, and its badge. */
export const BEST_PRACTICES = "https://www.bestpractices.dev/projects/16074";
export const BEST_PRACTICES_BADGE = `${BEST_PRACTICES}/badge`;

/** Container images (GitHub Container Registry), multi-arch (amd64 + arm64). */
export const IMAGE_REGISTRY = "ghcr.io/0x00spor3";
export const IMAGES: { name: string; blurb: string }[] = [
  { name: "waf-enterprise", blurb: "The data plane: the WAF proxy with every component wired in." },
  { name: "waf-controlplane", blurb: "The control plane: API, embedded dashboard and governance." },
  { name: "waf-node-agent", blurb: "Pulls published rulesets onto a WAF node and triggers a reload." },
  { name: "waf-operator", blurb: "The Kubernetes operator for the WafProxy custom resource." },
];

/** Left-nav for the documentation area. */
export const DOCS_NAV: { group: string; items: { label: string; href: string }[] }[] = [
  {
    group: "Get started",
    items: [
      { label: "Overview", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "Concepts", href: "/docs/concepts" },
      { label: "Full stack", href: "/docs/full-stack" },
    ],
  },
  {
    group: "Reference",
    items: [
      { label: "Configuration", href: "/docs/configuration" },
      { label: "Detection modules", href: "/docs/modules" },
      { label: "At-scale components", href: "/docs/components" },
    ],
  },
  {
    group: "Operate",
    items: [
      { label: "Control plane", href: "/docs/control-plane" },
      { label: "Rule management", href: "/docs/rule-management" },
      { label: "Governance", href: "/docs/governance" },
      { label: "Compliance & SIEM", href: "/docs/compliance-siem" },
      { label: "Operations", href: "/docs/operations" },
      { label: "Kubernetes", href: "/docs/kubernetes" },
    ],
  },
];

type Crate = { name: string; blurb: string };
const crate = (name: string, blurb: string): Crate => ({ name, blurb });
export const crateUrl = (name: string) => `https://crates.io/crates/${name}`;

/** Published crates (crates.io), all on the same version. */
export const CORE_CRATES: Crate[] = [
  crate("waf-proxy", "The reverse-proxy binary — cargo install it and run it as waf."),
  crate("waf-core", "Base types, config, and client-IP resolution."),
  crate("waf-normalizer", "Decoding, NFKC, and request parsing (anti-evasion)."),
  crate("waf-pipeline", "Phased orchestration and anomaly scoring."),
  crate("waf-detection", "Detection modules, the CRS engine, and the fast-path prefilter."),
  crate("waf-wasm", "The Proxy-Wasm plugin runtime (wasmi)."),
];
export const COMPONENT_CRATES: Crate[] = [
  crate("waf-enterprise", "The data-plane binary with every component wired in."),
  crate("waf-state-redis", "Redis state store: cluster-wide rate limiting and shared certificates."),
  crate("waf-tls-managed", "Managed TLS: ACME (TLS-ALPN-01, DNS-01), hitless rotation, mutual TLS."),
  crate("waf-threatintel", "IP reputation module and the single-writer threat-intel feed."),
  crate("waf-crs-curated", "Curated SecRule content: CVE, application and evasion signatures."),
  crate("waf-schema-enforcement", "GraphQL, gRPC and OpenAPI schema enforcement, and bot detection."),
  crate("waf-wasm-signing", "Minisign verification of WASM plugins before they load."),
  crate("waf-capture", "Off-path capture of full denied requests for the drill-down."),
];
