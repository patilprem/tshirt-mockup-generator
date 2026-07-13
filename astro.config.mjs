// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://freeteemockup.com',
  // Emit `page.html` instead of `page/index.html` so Cloudflare Pages serves
  // pages at the extensionless no-trailing-slash URL used by the canonicals
  // and the sitemap, instead of 308-redirecting `/page` to `/page/`.
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404') && !page.includes('/500'),
    }),
  ],
});
