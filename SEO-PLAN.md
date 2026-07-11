# FreeTeeMockup SEO Plan

Working plan for https://freeteemockup.com. Work happens in batches on `seo/*` branches, merged to `main` via PR. Update this doc as phases complete.

## Shipped so far

- 8 garment landing pages (crewneck, hoodie, sweatshirt, tank top, v-neck, long sleeve, polo, ladies tee) with WebApplication + Breadcrumb + FAQ JSON-LD, canonicals, and deep links into the editor (`/editor?garment=…`)
- 3 competitor-alternative pages (Placeit, Mockey, Canva) and 3 use-case pages (Etsy, Shopify, print-on-demand)
- Horizontal branded hero banners on all 14 landing pages
- Footer internal linking across all pages, robots.txt, GA4, noindex guard on `.pages.dev` previews

## Phase 1 — Technical quick wins (this branch)

- [x] Schema audit: every landing page has all 3 JSON-LD blocks (verified 2026-07-12)
- [x] Per-page OG/Twitter images: `ogImage` prop on PageLayout, each landing page shares its hero banner image instead of the generic `og-image.png`
- [x] Automated sitemap: set `site` in `astro.config.mjs` + `@astrojs/sitemap` (pinned 3.1.6 — newer versions need Astro 5), retired the hand-maintained `public/sitemap.xml`, robots.txt points at `sitemap-index.xml`
- [ ] **Owner action — Google Search Console:** verify the `freeteemockup.com` domain at https://search.google.com/search-console (DNS TXT record is the easiest for a domain property), then submit `sitemap-index.xml`. Do the same at https://www.bing.com/webmasters (can import from GSC). All Phase 5 prioritization depends on this data.

## Phase 2 — Content depth (blog/guides)

Landing pages capture "mockup generator" intent; a `/blog` captures the informational long tail and feeds internal authority (hub-and-spoke). Planned first posts, in order:

1. How to make a t-shirt mockup for free (step-by-step with the editor)
2. T-shirt design placement & size guide (evergreen, link-worthy)
3. Best free t-shirt mockup generators in 2026 (comparison listicle)
4. How to create Etsy listing photos for print-on-demand shirts
5. Mockup vs. product photography: what converts better

Each post deep-links to the relevant garment and use-case pages.

## Phase 3 — More landing pages (selective)

- Competitor alternatives: Smartmockups, Mediamodifier, Printful mockup generator, Vexels
- Seller platforms: Redbubble, Amazon Merch, TeePublic
- **Avoid** thin color/style variant pages ("black t-shirt mockup" etc.) unless each page is genuinely distinct — near-duplicate landing pages risk being treated as doorway pages.

## Phase 4 — Off-site (owner submits, content prepared here)

- Free-tool directories, AlternativeTo listing, Product Hunt launch
- Design / print-on-demand community posts (draft copy per channel first)

## Phase 5 — Iterate on Search Console data (4–6 weeks after Phase 1)

- Rewrite titles/descriptions on high-impression, low-CTR pages
- Expand pages ranking on page 2 for their target query
- Prune or merge pages with zero impressions
