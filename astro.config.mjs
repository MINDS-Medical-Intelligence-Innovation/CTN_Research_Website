import { defineConfig } from 'astro/config';

// TODO: replace with the real production domain once chosen (see docs/DECISIONS.md D8 —
// domain shortlist not yet finalised). Using a placeholder Cloudflare Pages-style URL for now.
const SITE_URL = 'https://example.pages.dev';

export default defineConfig({
  site: SITE_URL,
  // Optional BASE_PATH env var lets this build cleanly for GitHub Pages-style project hosting
  // (e.g. BASE_PATH=/ctn-research-website/). Defaults to root for custom-domain hosting.
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
