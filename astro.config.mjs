// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Static marketing site for Light WAF. No SSR — builds to a folder of static assets deployable to
// any host (GitHub Pages, S3, Netlify, …).
//
// `site` is the canonical domain: it drives canonical URLs, the Open Graph / Twitter URLs, and the
// generated sitemap. Keep public/robots.txt's Sitemap line in sync with it.
export default defineConfig({
  site: "https://lightwaf.org",
  integrations: [sitemap()],
  build: { assets: "assets" },
});
