// SPDX-FileCopyrightText: 2026 0x00spor3
// SPDX-License-Identifier: BUSL-1.1
// Shared site constants. The OPEN core is public (GitHub + crates.io); the enterprise tier's source
// is private, so the site links only to the public core.

export const CORE_REPO = "https://github.com/0x00spor3/Light-WAF";
/** Release history (canonical source — no hand-maintained changelog to drift). */
export const RELEASES = `${CORE_REPO}/releases`;

/** Enterprise sales/access contact. */
export const CONTACT_EMAIL = "0x00spor3@gmail.com";
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}?subject=Light%20WAF%20Enterprise%20%E2%80%94%20access%20request`;

/** Left-nav for the public core documentation area. */
export const DOCS_NAV: { group: string; items: { label: string; href: string }[] }[] = [
  {
    group: "Get started",
    items: [
      { label: "Overview", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
    ],
  },
  {
    group: "Reference",
    items: [
      { label: "Configuration", href: "/docs/configuration" },
      { label: "Detection modules", href: "/docs/modules" },
    ],
  },
];

/** The published OPEN-core crates (crates.io). `waf-corpus` (validation/benchmarks) is not published. */
export const CRATES: { name: string; url: string; blurb: string }[] = [
  { name: "waf-proxy", url: "https://crates.io/crates/waf-proxy", blurb: "The reverse-proxy binary — cargo install it and run as waf." },
  { name: "waf-core", url: "https://crates.io/crates/waf-core", blurb: "Base types, config, and client-IP resolution." },
  { name: "waf-normalizer", url: "https://crates.io/crates/waf-normalizer", blurb: "Decoding, NFKC, and request parsing (anti-evasion)." },
  { name: "waf-pipeline", url: "https://crates.io/crates/waf-pipeline", blurb: "Phased orchestration and anomaly scoring." },
  { name: "waf-detection", url: "https://crates.io/crates/waf-detection", blurb: "Detection modules, rules, and the fast-path prefilter." },
  { name: "waf-wasm", url: "https://crates.io/crates/waf-wasm", blurb: "The Proxy-Wasm plugin runtime (wasmi)." },
];
