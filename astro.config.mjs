import { defineConfig } from 'astro/config';

// Optional SITE_URL env var lets deploy.yml point canonical URLs at the current GitHub Pages
// host (https://techycardiac.github.io) without hard-coding it here. Falls back to a
// placeholder Cloudflare Pages-style URL for local builds. TODO: both this fallback and
// deploy.yml's SITE_URL change once the dedicated GitHub org / custom domain from
// docs/DECISIONS.md D8 lands.
export default defineConfig({
  site: process.env.SITE_URL || 'https://example.pages.dev',
  // Optional BASE_PATH env var lets this build cleanly for GitHub Pages-style project hosting
  // (e.g. BASE_PATH=/ctn-research-website/). Defaults to root for custom-domain hosting.
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
});
