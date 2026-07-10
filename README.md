<!-- SPDX-FileCopyrightText: 2026 0x00spor3
     SPDX-License-Identifier: BUSL-1.1 -->

# Light WAF — marketing site

A static marketing landing built with [Astro](https://astro.build). It shares the control-plane's
**"The Threshold"** visual identity (teal signal accent, Space Grotesk / IBM Plex, dark) and reuses
the dashboard screenshots from `public/shots/`.

## Develop

```sh
npm install
npm run dev        # http://localhost:4321
```

## Build & deploy

```sh
npm run build      # → dist/ (static, deployable to any host: GitHub Pages, S3, Netlify, …)
npm run preview    # serve dist/ locally
```

The site is fully static (no SSR, no runtime). Before publishing:

1. Set `site` in [`astro.config.mjs`](astro.config.mjs) to the canonical URL.
2. Set `CORE_REPO` at the top of [`src/pages/index.astro`](src/pages/index.astro) to the real **public
   core** repository URL (default is a placeholder). The site links only to the public OPEN core — the
   enterprise tier's source is private, so it is presented as a commercial tier with no source links.

## Structure

| Path | What |
|---|---|
| `src/pages/index.astro` | the one-page landing (all sections) |
| `src/layouts/Base.astro` | HTML shell, fonts, meta |
| `src/components/Meter.astro` | the animated **Verdict Meter** hero visual (the signature) |
| `src/components/BrandMark.astro` | the mini verdict-meter brand glyph |
| `src/styles/global.css` | design tokens + all section styles |
| `public/shots/` | dashboard screenshots (copied from the control-plane `ui/design-preview/`) |

## Updating the screenshots

The dashboard shots come from the control-plane UI review captures. Regenerate those, then copy the
ones you want into `public/shots/` (`overview.png`, `event-detail.png`, `compliance.png`, …).
