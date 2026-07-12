# FreeTeeMockup SEO Plan

Working plan for https://freeteemockup.com. Work happens in batches on `seo/*` branches, merged to `main` via PR. Update this doc as phases complete.

## Owner to-do list (things only you can do)

Everything below requires account access or publishing under your identity, so Claude prepares but you execute. Roughly in priority order:

- [ ] **Merge open `seo/*` PRs** as they appear — nothing goes live until merged and deployed.
- [ ] **Google Search Console** (highest priority): verify `freeteemockup.com` as a *domain property* at https://search.google.com/search-console — add the TXT record it gives you to your DNS. Then Sitemaps → submit `sitemap-index.xml`. Takes ~10 minutes; unblocks all of Phase 5.
- [ ] **Bing Webmaster Tools**: sign in at https://www.bing.com/webmasters and use "Import from Google Search Console" — fastest path once GSC is verified.
- [ ] **Check GA4 is receiving data** (property `G-X8VXX3PN94`): confirm real traffic shows up and set the landing-page CTA clicks as a conversion event, so we can tell which pages actually convert.
- [ ] **Product Hunt launch**: create/claim a maker account and schedule the launch (Tue–Thu mornings US time perform best). Ask Claude first — the tagline, description, gallery images, and first-comment draft should be prepared before you schedule.
- [ ] **Directory submissions** (each ~5 min, backlink value adds up): AlternativeTo (list FreeTeeMockup as an alternative to Placeit/Smartmockups/Mockey), free-tool directories (e.g. toolify.ai, insanelycooltools.com, futurepedia if AI-angle fits). Claude drafts the copy; you create the listings.
- [ ] **Community sharing**: once the first blog guides exist, share them where POD sellers hang out — r/printondemand, r/Etsy (mind self-promo rules — contribute, don't just drop links), Etsy seller Facebook groups, Printful/Printify community forums. Claude drafts per-channel posts on request.
- [ ] **After 4–6 weeks of GSC data**: export the Search results report (queries + pages) and share it in a session so Phase 5 iteration can be data-driven rather than guesswork.

## Shipped so far

- 8 garment landing pages (crewneck, hoodie, sweatshirt, tank top, v-neck, long sleeve, polo, ladies tee) with WebApplication + Breadcrumb + FAQ JSON-LD, canonicals, and deep links into the editor (`/editor?garment=…`)
- 3 competitor-alternative pages (Placeit, Mockey, Canva) and 3 use-case pages (Etsy, Shopify, print-on-demand)
- Horizontal branded hero banners on all 14 landing pages
- Footer internal linking across all pages, robots.txt, GA4, noindex guard on `.pages.dev` previews

## Phase 1 — Technical quick wins (this branch)

- [x] Schema audit: every landing page has all 3 JSON-LD blocks (verified 2026-07-12)
- [x] Per-page OG/Twitter images: `ogImage` prop on PageLayout, each landing page shares its hero banner image instead of the generic `og-image.png`
- [x] Automated sitemap: set `site` in `astro.config.mjs` + `@astrojs/sitemap` (pinned 3.1.6 — newer versions need Astro 5), retired the hand-maintained `public/sitemap.xml`, robots.txt points at `sitemap-index.xml`
- [ ] Search Console + Bing verification and sitemap submission → see the owner to-do list above

## Phase 2 — Content depth (blog/guides)

Landing pages capture "mockup generator" intent; a `/blog` captures the informational long tail and feeds internal authority (hub-and-spoke). Blog hub lives at `/blog` (posts are plain `.astro` pages under `src/pages/blog/`, listed in the hub's `posts` array — add new posts there). Nav + footer link to it site-wide. Planned first posts, in order:

1. [x] How to make a t-shirt mockup for free (step-by-step with the editor) — shipped 2026-07-12
2. [x] T-shirt design placement & size guide (evergreen, link-worthy) — shipped 2026-07-12
3. [x] Best free t-shirt mockup generators in 2026 (comparison listicle) — shipped 2026-07-12
4. [x] How to create Etsy listing photos for print-on-demand shirts — shipped 2026-07-12
5. [x] Mockup vs. product photography: what converts better — shipped 2026-07-12

**Phase 2 complete** — all five planned posts live. Future posts: add to `src/pages/blog/`, list in the hub's `posts` array, generate a contextual banner with a `scratch/generate_*_banner.cjs` script.

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
