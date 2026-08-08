# FreeTeeMockup SEO Plan

Working plan for https://freeteemockup.com. Work happens in batches on `seo/*` branches, merged to `main` via PR. Update this doc as phases complete.

Companion docs: [PRODUCT-PLAN.md](PRODUCT-PLAN.md) (what to build) and
[MONETIZATION-PLAN.md](MONETIZATION-PLAN.md) (what the traffic is worth — holds the 2026-08-08
GA4 + Search Console baseline that Phase 5 below is built on).

## Owner to-do list (things only you can do)

Everything below requires account access or publishing under your identity, so Claude prepares but you execute. Roughly in priority order:

- [ ] **Exclude your own devices from export stats** (now the highest priority — the first analytics
  pull is polluted without it): on every browser you test with, visit
  `https://freeteemockup.com/editor?notrack=1` once — that browser's exports then never count in
  GA4 or /stats (undo with `?notrack=0`; the browser console confirms the state). Evidence it is
  still outstanding: `/editor` shows 82 landing sessions from 21 users but only 8 new, and
  `mockup_download` shows 300 events from 33 users. See [MONETIZATION-PLAN.md](MONETIZATION-PLAN.md) §3.
- [ ] **Activate the GA4 internal traffic filter** — `notrack` only suppresses *export events*;
  `PageLayout.astro` fires `gtag('config', …)` on every page load with no guard, so your pageviews
  are all counted. Admin → Data streams → the stream → Configure tag settings → **Define internal
  traffic** (add your IP), then Admin → Data settings → **Data filters** → switch "Internal Traffic"
  from *Testing* to **Active**. It is created inactive by default.
- [ ] **Merge open `seo/*` PRs** as they appear — nothing goes live until merged and deployed.
- [x] **Google Search Console**: verified as a domain property; sitemap submitted. First non-zero
  data day is **2026-06-21**, so treat that — not the site's launch — as the start of search history.
- [ ] **Bing Webmaster Tools**: sign in at https://www.bing.com/webmasters and use "Import from Google Search Console" — fastest path once GSC is verified.
- [x] **Private stats page setup** — D1 bound as `DB`, `STATS_KEY` set, `/stats` live and recording.
  The dashboard was rebuilt on 2026-08-08 (PR #39) around one unit, exported images, with
  period-over-period deltas; see the header comment in `functions/stats.js`.
- [x] **Check GA4 is receiving data** (property `G-X8VXX3PN94`) — confirmed 2026-08-08: 90 days of
  data, and `mockup_download` + `batch_export` are both registering as key events (they reconcile
  exactly to 308 across the channel report).
- [ ] **Product Hunt launch**: create/claim a maker account and schedule the launch (Tue–Thu mornings US time perform best). Ask Claude first — the tagline, description, gallery images, and first-comment draft should be prepared before you schedule.
- [ ] **Directory submissions** (each ~5 min, backlink value adds up): AlternativeTo (list FreeTeeMockup as an alternative to Placeit/Smartmockups/Mockey), free-tool directories (e.g. toolify.ai, insanelycooltools.com, futurepedia if AI-angle fits). Claude drafts the copy; you create the listings.
- [ ] **Community sharing**: once the first blog guides exist, share them where POD sellers hang out — r/printondemand, r/Etsy (mind self-promo rules — contribute, don't just drop links), Etsy seller Facebook groups, Printful/Printify community forums. Claude drafts per-channel posts on request.
- [x] **After 4–6 weeks of GSC data**: done 2026-08-08. Full analysis in
  [MONETIZATION-PLAN.md](MONETIZATION-PLAN.md) §2. Headline: 8 clicks / 166 impressions in ~7 weeks;
  every commercial head term sits at position 73–97; `/t-shirt-mockups-for-etsy` holds 52% of all
  impressions at position 26 and is the one page within reach of page 1. **Re-do this pull three
  weeks after the two tracking fixes at the top of this list.**

## Shipped so far

- 8 garment landing pages (crewneck, hoodie, sweatshirt, tank top, v-neck, long sleeve, polo, ladies tee) with WebApplication + Breadcrumb + FAQ JSON-LD, canonicals, and deep links into the editor (`/editor?garment=…`)
- 3 competitor-alternative pages (Placeit, Mockey, Canva) and 3 use-case pages (Etsy, Shopify, print-on-demand)
- Horizontal branded hero banners on all 14 landing pages
- Footer internal linking across all pages, robots.txt, GA4, noindex guard on `.pages.dev` previews
- Trailing-slash fix (2026-07-13): `build.format: 'file'` + `trailingSlash: 'never'` so Cloudflare Pages serves pages directly at the no-slash URLs used by canonicals/sitemap instead of 308-redirecting them (GSC was reporting "Page with redirect" / "Alternative page with proper canonical tag"); added the missing canonical on `/editor` to consolidate `?garment=…` deep links
- GSC "Why pages aren't indexed" cleanup (2026-07-28): fixed the homepage's canonical/`og:url`/JSON-LD `url` trailing-slash mismatch vs the sitemap. Audited all four flagged reasons — most of the 23 pages were external backlink noise (the `www` subdomain and `?ref=producthunt` / `?ref=launches.uicomet.com` tracking params on otherwise-correct URLs), not code bugs. Deployed a Cloudflare `www → apex` 301 redirect (Rules → Redirect Rules, wildcard `https://www.freeteemockup.com/*` → `https://freeteemockup.com/${1}`) to consolidate those. The "Redirect error" group (5 garment/use-case pages) pre-dated the July 13 fix by one day — spot-checked live, then validated in GSC. Requested indexing for `/editor` via URL Inspection since it had never been crawled despite being linked from every landing page.

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

- [x] Bulk/batch export cluster (2026-07-15): `/bulk-t-shirt-mockup-generator` landing page,
  `/blog/batch-export-t-shirt-mockups` post, homepage showcase section, and "Bulk / batch export"
  rows on all three competitor-alternative tables — feature-led pages, not thin variants.

- Competitor alternatives: Smartmockups, Mediamodifier, Printful mockup generator, Vexels
- Seller platforms: Redbubble, Amazon Merch, TeePublic
- **Avoid** thin color/style variant pages ("black t-shirt mockup" etc.) unless each page is genuinely distinct — near-duplicate landing pages risk being treated as doorway pages.

## Phase 4 — Off-site (owner submits, content prepared here)

- Free-tool directories, AlternativeTo listing, Product Hunt launch
- Design / print-on-demand community posts (draft copy per channel first)

## Phase 5 — Iterate on Search Console data

First pull done 2026-08-08 (full tables in [MONETIZATION-PLAN.md](MONETIZATION-PLAN.md) §2). What
the data changed about this phase:

- **`/t-shirt-mockups-for-etsy` is the priority page.** 87 impressions — 52% of the site's total —
  at position 26.14 with 0 clicks, and an audience that is overwhelmingly US-based. It is the only
  page within reach of page 1, and moving it there fixes both the traffic and the tier-1 geography
  problem (currently 12.5% of clicks) at once.
- **Stop chasing the "free … mockup generator" head terms.** They sit at positions 73–97 against
  Placeit, Canva and Mockey. That is a domain-authority gap, not a title-tag gap; rewriting metadata
  will not move page 8 to page 1.
- **Nothing to prune yet.** The 14 landing pages have barely been crawled into competition — most
  have 1–21 impressions. Give them time rather than merging them.
- **ChatGPT is already the bigger channel, and this plan cannot see it.** Verified 2026-08-08
  (MONETIZATION-PLAN.md §1b): `chatgpt.com` sent **186 sessions and 253 exports** over 60 days
  against `google / organic`'s **18 sessions and 0 exports** — 10:1 on traffic, and every export
  Google did not produce. None of it appears in Search Console. Phase 4's directory and Product Hunt
  work feeds that channel as well as classic SEO, which makes it the highest-value item left in this
  plan rather than an afterthought — `producthunt.com` and `system.toolify.ai` already show up as
  referrers.
- Original intent, still valid once there is more data: rewrite titles/descriptions on
  high-impression low-CTR pages, expand pages ranking on page 2, prune or merge dead pages.
