// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://freeteemockup.com',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404') && !page.includes('/500'),
      serialize(item) {
        // Match the canonical URLs, which have no trailing slash (except the root).
        const url = new URL(item.url);
        if (url.pathname !== '/') {
          item.url = item.url.replace(/\/$/, '');
        }
        return item;
      },
    }),
  ],
});
