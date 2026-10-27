<!-- SPDX-FileCopyrightText: 2026 0x00spor3
     SPDX-License-Identifier: Apache-2.0 -->

# Light WAF — website

The site for [Light WAF](https://github.com/0x00spor3/Light-WAF), served at <https://lightwaf.org>.
Built with [Astro](https://astro.build); it shares the control-plane's **"The Threshold"** visual
identity (teal signal accent, Space Grotesk / IBM Plex, dark) and reuses the dashboard screenshots in
`public/shots/`.

## Develop

```sh
npm install
npm run dev        # http://localhost:4321
```

## Build & deploy

```sh
npm run build      # → dist/ (static: no SSR, no runtime)
npm run preview    # serve dist/ locally
```

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`). The canonical
domain is `site` in [`astro.config.mjs`](astro.config.mjs) — keep `public/CNAME` and the `Sitemap`
line in `public/robots.txt` in sync with it.

## Structure

| Path | What |
|---|---|
| `src/consts.ts` | version, repository links, container images, crate lists, docs navigation |
| `src/pages/index.astro` | home |
| `src/pages/core.astro` | the core (`waf`) |
| `src/pages/scale.astro` | at-scale components, control plane, Kubernetes |
| `src/pages/architecture.astro` | core vs components, the seams, licensing |
| `src/pages/community.astro` | contributing, security reporting, code of conduct |
| `src/pages/docs/` | documentation: `.astro` pages and Markdown (`.md`) pages |
| `src/layouts/DocsLayout.astro` | docs shell: left nav and previous/next links (works for `.md` pages too) |
| `src/layouts/Base.astro` | HTML shell, fonts, meta, JSON-LD |
| `src/components/Meter.astro` | the animated **Verdict Meter** hero visual |
| `src/styles/global.css` | design tokens and all styles, including the Markdown code palette |
| `public/shots/` | dashboard screenshots |

Old URLs `/enterprise` and `/boundary` redirect to `/scale` and `/architecture` (`redirects` in
`astro.config.mjs`).

## Docs

The Markdown docs under `src/pages/docs/` are ported from the operator guide in the main repository
(`docs/01…09`). When a guide changes there, update the matching page here:

| Repository | Site |
|---|---|
| `docs/01-concepts.md` | `concepts.md` |
| `docs/02-getting-started.md` | `full-stack.md` |
| `docs/03-waf-configuration.md` | `configuration.md` (core sections) + `components.md` (`[enterprise.*]`, `[tls.acme]`, `[tls.mtls]`) |
| `docs/04` … `docs/09` | `control-plane.md`, `rule-management.md`, `governance.md`, `compliance-siem.md`, `operations.md`, `kubernetes.md` |

On a new release, bump `VERSION` in `src/consts.ts`.

## Updating the screenshots

The dashboard shots come from the control-plane UI review captures. Regenerate those, then copy the
ones you want into `public/shots/` (`overview.png`, `event-detail.png`, `compliance.png`, …).

## License

Apache-2.0 — see [LICENSE](LICENSE).
