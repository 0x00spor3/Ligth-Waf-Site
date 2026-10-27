// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Static site for Light WAF. No SSR — builds to a folder of static assets deployable to any host
// (GitHub Pages, S3, Netlify, …).
//
// `site` is the canonical domain: it drives canonical URLs, the Open Graph / Twitter URLs, and the
// generated sitemap. Keep public/robots.txt's Sitemap line in sync with it.
export default defineConfig({
  site: "https://lightwaf.org",
  integrations: [sitemap()],
  build: { assets: "assets" },
  // Pages renamed when the project went fully open source (1.0.0). The old URLs were shared, so
  // they keep working as static redirects.
  redirects: {
    "/enterprise": "/scale",
    "/boundary": "/architecture",
  },
  // Docs pages are Markdown. The css-variables theme maps code tokens to the site palette
  // (`--astro-code-*` in global.css) instead of a fixed Shiki theme.
  markdown: {
    shikiConfig: { theme: "css-variables" },
  },
});
