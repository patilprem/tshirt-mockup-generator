# FreeTeeMockup Monetization Plan

Companion to [SEO-PLAN.md](SEO-PLAN.md) (brings sellers in) and [PRODUCT-PLAN.md](PRODUCT-PLAN.md)
(makes the tool better than the alternatives). This one asks what the traffic is worth and how it
turns into money.

**Written 2026-08-08 against the first real analytics pull.** The headline finding is that there is
no revenue to collect yet and the reason is not the monetization model — it is traffic volume and
traffic geography. Sections 1–3 are the evidence; section 5 is the plan.

---

## 0. The constraint we are working inside

PRODUCT-PLAN.md defines the wedge as **truly free, no signup, no watermark, files never leave the
browser**, and lists "watermark/paid tiers of any kind" under *Explicitly not doing*. The domain is
`freeteemockup.com`. That is a real moat and it is also a hard ceiling:

> **Every dollar has to come from someone other than the person using the editor, or from a
> genuinely separate product.**

So the menu is affiliate, ads, sponsorship, or B2B — not "convert 3% of users to $9/mo". Nothing
below asks an end user for money.

Competitor free tiers, for reference — this is the wedge working:

| Tool | Free tier | Paid |
|---|---|---|
| Placeit | Watermarked previews | $14.95/mo · $89.69/yr |
| Mockey.ai | 3 downloads/day, 400×500px, **no commercial use** | $7/mo · $19/mo |
| Dynamic Mockups | 50 one-time credits | from $15/mo, credit-based, has an API |

---

## 1. Baseline — GA4, 10 May to 7 Aug 2026 (90 days)

Property `G-X8VXX3PN94` ("TeeMockup"). **591 sessions · 1,025 pageviews · 387 users · 308 exports.**

### Channels

| Channel | Sessions | Engaged | Engagement rate | Avg time | Exports |
|---|---|---|---|---|---|
| Direct | 310 | 91 | 29.4% | 29.3s | 29 |
| **AI Assistant** | **169** | **116** | **68.6%** | **80.6s** | **237** |
| Organic Social | 42 | 25 | 59.5% | 66.0s | 7 |
| Organic Search | 29 | 17 | 58.6% | 49.1s | 4 |
| Organic Video | 23 | 13 | 56.5% | 36.9s | 0 |
| Referral | 9 | 6 | 66.7% | 18.2s | 0 |
| Unassigned | 9 | 4 | 44.4% | 197.6s | 31 |

Key events reconcile exactly to exports: 29 + 237 + 7 + 4 + 31 = **308** = `mockup_download` (300)
+ `batch_export` (8).

**Resolved 2026-08-08 — see §1b.** An earlier draft called this channel real without checking; a
second draft called it our own link-clicking, also without checking. A source/city/hostname
exploration settled it: the channel is genuine **ChatGPT** referral traffic, not us.

### Landing pages

| Landing page | Sessions | Active users | New users | Avg time | Exports |
|---|---|---|---|---|---|
| `/` | 435 | 354 | 358 | 55.1s | 284 |
| `/editor` | 82 | 21 | 8 | 54.3s | 17 |
| (not set) | 41 | 25 | 0 | 11.7s | 7 |
| `/contact` | 9 | 9 | 9 | 2.9s | 0 |
| `/about` | 7 | 6 | 6 | 29.9s | 0 |
| `/blog` | 3 | 2 | 1 | 82.7s | 0 |
| `/terms` | 3 | 3 | 3 | 1.7s | 0 |

Then 1–2 sessions each for `/blog/how-to-make-a-t-shirt-mockup-for-free`,
`/crewneck-mockup-generator`, `/privacy`, `/cmd_sco`, `/free-canva-mockup-alternative`,
`/hoodie-mockup-generator`, `/mockey-alternative`, `/stats`.

The homepage is doing all the work. **The 14 SEO landing pages have essentially never been an entry
point.** `/cmd_sco` is not a page in this repo — that is a vulnerability scanner, so there is bot
noise in the set too.

### Events

| Event | Count | Users | Per user |
|---|---|---|---|
| `page_view` | 1,025 | 387 | 2.66 |
| `user_engagement` | 694 | 237 | 2.93 |
| `session_start` | 593 | 387 | 1.54 |
| `first_visit` | 390 | 386 | 1.01 |
| `scroll` | 338 | 147 | 2.30 |
| `mockup_download` | 300 | 33 | **9.09** |
| `batch_export` | 8 | 7 | 1.14 |
| `form_start` | 7 | 7 | 1.00 |

`batch_export` — the feature PRODUCT-PLAN.md picked to attack Mockey's #1 paid feature — has been
used 8 times by 7 people.

---

## 1b. Who is actually sending the traffic (resolved 2026-08-08)

GA4 Explore, dimensions *Session source/medium* × *Town/City* × *Hostname*, **9 Jun – 8 Aug 2026**
(60 days — a different window from §1, and it holds **627 sessions / 346 exports**, i.e. more
sessions in fewer days, so traffic is growing).

### The AI channel is real, and it is ChatGPT

| Source / medium | Sessions | Exports |
|---|---|---|
| `chatgpt.com / ai-assistant` | **184** | **239** |
| `chatgpt.com / (none)` | 2 | 14 |
| `copilot.com` (both mediums) | 10 | 17 |
| **`claude.ai / ai-assistant`** | **3** | **0** |

Claude sent three sessions and zero exports, from Palakkad. The ChatGPT traffic is spread across
**~130 distinct cities** on every continent — Accra, Bucharest, Cape Town, Melbourne, Bakersfield,
Ho Chi Minh City, Kigali, Buenos Aires — a footprint no single person produces.

**ChatGPT is the single biggest acquisition channel: 186 sessions and 253 exports, against
`google / organic`'s 18 sessions and 0 exports.** The SEO plan is aimed at the smaller one.

### What *is* us — Mumbai metro

| Source | Mumbai + Thane + Navi Mumbai + Mira Bhayandar |
|---|---|
| `(direct) / (none)` | 95 sessions, 9 exports |
| `t.co / referral` | 44 sessions, 7 exports |
| `youtube.com / referral` | 23 sessions, 0 exports |
| `google / organic` | 11 sessions, 0 exports |
| **Total** | **~173 sessions — 28% of all traffic** |

Every `t.co` and `youtube.com` session is Mumbai metro, so those are our own promotion rather than
distribution.

### Bots and non-production hostnames

Inside Direct: **Council Bluffs 35, Boardman 13, Ashburn 12, The Dalles 2** — Google and AWS
datacentres, ~62 sessions and zero exports — plus `(not set)` 30.

Hostnames: `tshirt-mockup-generator.pages.dev` 17, `www.freeteemockup.com` 11, **`localhost` 8**.
The earlier worry that `npm run dev` was flooding the data was overstated: localhost is 1.3% of
sessions.

### Exports are concentrated in a handful of power users

| City | Exports | Sessions |
|---|---|---|
| Mosta (Malta) | **131** | 4 |
| Marrakesh | 48 | 2 |
| Sialkot | 31 | 1 |
| Benidorm | 32 | 8 |

**Four locations produce 242 of 346 exports — 70%.** Mosta alone is 38%, at ~33 exports per
session. Real users, but "308 exports" was never 308 people.

### Tier-1 within the ChatGPT channel

Roughly 34 of 184 sessions (~18%) come from US/UK/CA/AU cities, and they account for ~15 of 239
exports (~6%). Better than the 12.5% in Search Console, still far short of the 50% the high-RPM ad
networks require. **The §4 verdict on advertising does not move.**

---

## 2. Baseline — Search Console, 21 Jun to 6 Aug 2026

Filter was "Last 3 months / Web", but the first non-zero day is **2026-06-21**, so this is ~7 weeks
of data, not 12. Google has known the site for less time than SEO-PLAN.md assumes.

**8 clicks · 166 impressions · 4.8% CTR · average position ~37.**

### Pages

| Page | Clicks | Impressions | CTR | Position |
|---|---|---|---|---|
| `/` | **8** | 48 | 16.67% | 46 |
| `/t-shirt-mockups-for-etsy` | 0 | **87** | 0% | **26.14** |
| `/v-neck-mockup-generator` | 0 | 21 | 0% | 28.29 |
| `/print-on-demand-mockups` | 0 | 20 | 0% | 50.9 |
| `/free-canva-mockup-alternative` | 0 | 10 | 0% | 19.3 |
| `/privacy` | 0 | 5 | 0% | **3.2** |
| `/editor` | 0 | 5 | 0% | 10 |
| `/sweatshirt-mockup-generator` | 0 | 4 | 0% | 5.75 |
| `/ladies-tee-mockup-generator` | 0 | 4 | 0% | 7.5 |
| `/tank-top-mockup-generator` | 0 | 4 | 0% | 12.5 |
| `www.freeteemockup.com/v-neck-mockup-generator` | 0 | 1 | 0% | 3 |

Every click comes from the homepage. `/t-shirt-mockups-for-etsy` carries **52% of all impressions**
and is the only page within reach of page 1. The `www` host still surfaced once, so the
July www→apex redirect may not be fully absorbed.

### Queries

| Query | Impressions | Position |
|---|---|---|
| free tshirt mockup generator | 14 | **75.71** |
| t shirt mockup generator free | 4 | 73 |
| free shirt mockup generator | 3 | 79 |
| print on demand mockup generator | 3 | 79 |
| **etsy tshirt mockup** | 2 | **22.5** |
| free t shirt mockup generator | 2 | 74.5 |
| t shirt generator | 1 | 2 |
| free t-shirt mockup generator | 1 | 75 |
| free apparel mockup generator | 1 | 76 |
| t-shirt mockup free online | 1 | 95 |
| best mockup for print on demand | 1 | 97 |

Zero clicks on every listed query. The commercial head terms sit on **page 8**, against Placeit,
Canva and Mockey. Meanwhile `/privacy` ranks 3.2 and `/sweatshirt-mockup-generator` ranks 5.75 —
the site ranks well for things nobody searches. This is a domain-authority problem, not a
title-tag problem.

### Countries — the number that decides ad viability

| Country | Clicks | Impressions | Country | Clicks | Impressions |
|---|---|---|---|---|---|
| India | 3 | 13 | Indonesia | 0 | 9 |
| **United States** | **1** | 45 | Iraq | 0 | 6 |
| Philippines | 1 | 8 | Morocco | 0 | 6 |
| Turkey | 1 | 5 | France | 0 | 4 |
| Mexico | 1 | 4 | Pakistan | 0 | 4 |
| Bangladesh | 1 | 3 | Ukraine | 0 | 4 |
| Vietnam | 0 | 25 | United Kingdom | 0 | 2 |
| Thailand | 0 | 12 | Canada | 0 | 1 |
| Russia | 0 | 9 | Australia | 0 | 0 |

**Tier-1 is 1 of 8 clicks — 12.5%.** Mediavine and Raptive both require ≥50% tier-1 below 100k
pageviews, so the site is ineligible for the high-RPM networks *regardless of volume*. Non-tier-1
display RPMs run ~$1–3 rather than ~$10–25.

### Devices

Desktop 8 clicks / 162 impressions (position 37.41) · Mobile 0 clicks / 4 impressions (48.75).
Effectively a desktop-only audience, which is consistent with POD sellers working at a computer.

---

## 3. ⚠️ The data above includes our own traffic

Verified in code, not assumed:

- **Pageviews are never excluded.** `src/layouts/PageLayout.astro` fires
  `gtag('config', 'G-X8VXX3PN94')` on every page load with no `notrack` guard, and no GA4
  internal-traffic filter is active. Every page we have ever loaded is inside that 1,025.
- **Exports are excluded only if `?notrack=1` was set.** `trackEvent()` in
  `src/components/Editor.astro` early-returns on `statsOptedOut`, which suppresses both the GA4
  event and the `/api/track` beacon. SEO-PLAN.md still lists that step as not done.
- **Local dev traffic is counted too.** `gtag('config', …)` fires on `localhost` as well — the only
  hostname guard in `PageLayout.astro` is the `.pages.dev` noindex check, which governs robots, not
  analytics. So every `npm run dev` session with a browser open sent pageviews, and every locally
  tested export fired `mockup_download`. This lands in **Direct**, whose 29% engagement rate and
  29s average now look like dev sessions rather than visitors.
- **Clicking our own links from an AI chat lands in "AI Assistant."** A link followed from a
  claude.ai or chatgpt.com conversation carries that referrer, so GA4 classifies it as AI Assistant
  rather than Direct. Given this repo is developed through Claude Code sessions, that channel is
  suspect by default rather than by exception.

Fingerprints in the data:

| Signal | Reading |
|---|---|
| `/editor` landing: 82 sessions, 21 users, **8 new** | ~13 people returning repeatedly and deep-linking straight into the editor — developer behaviour. Real users land on `/`. |
| `mockup_download`: 300 events / **33 users** | 9.1 exports per person |
| `Unassigned`: 9 sessions, **197.6s**, 31 exports | 3.4 exports per session |
| `/stats` appears as a landing page | Only the owner can open that page |
| `/cmd_sco` | Not a page in this repo — scanner traffic |

**Assessment (updated once §1b was run).** The contamination is real but smaller and more
localised than two earlier drafts of this section claimed. It is **Mumbai metro, ~173 sessions,
28% of traffic** — our own direct visits plus our own `t.co` and `youtube.com` promotion — together
with ~62 sessions of datacentre bot traffic and 36 sessions on non-production hostnames. It is
**not** the AI channel, which is genuine ChatGPT traffic across ~130 cities.

Two claims were made and withdrawn before the data settled it: first that the AI channel was
obviously real, then that it was obviously us. Both were assertions, not findings. The lesson is
recorded here rather than tidied away: **do not characterise a channel without a source/city
breakdown in front of you.**

**Both tracking fixes went in on 2026-08-08**, which is therefore day zero for *collection*. But
"polluted" is not binary and an earlier draft of this section treated it that way — including
lumping §2 in, which was simply wrong. How to actually use the historical data is §3b.

---

## 3b. How to use the historical data anyway

The pollution is **not evenly spread**, and it is **identifiable**, so the old data is filterable
rather than lost. Measured over the 60-day window in §1b:

| Metric | Ours + bots | Usable |
|---|---|---|
| Sessions (627) | ~40% | ~60% |
| **Exports (346)** | **16 — 4.6%** | **~95%** |

Mumbai metro is 28% of *sessions* but only 16 of 346 *key events*. Datacentre bots and
non-production hostnames produced **zero** exports. That asymmetry is the whole point: session
counts are materially wrong, export counts are close to right.

### Search Console: nothing to do

Following a link from a chat, browsing `localhost` or testing an export cannot create a Google
Search impression. Everything in §2 — 8 clicks, 166 impressions, positions 73–97, the 12.5% tier-1
mix, `/t-shirt-mockups-for-etsy` at 26.14 — is clean as recorded. The plan in §5 rests on it.

### GA4: filter it, do not discard it

Build one saved segment in Explore and every historical report becomes usable. Exclude sessions
where any of these hold:

- **Town/City** is Mumbai, Thane, Navi Mumbai or Mira Bhayandar — us
- **Hostname** is not `freeteemockup.com` — `localhost`, `pages.dev`, `www.`
- **Town/City** is Council Bluffs, Boardman, Ashburn or The Dalles — Google/AWS datacentres

**Known bias: this under-counts.** Excluding Mumbai also excludes real Indian users, and India was
the top country by clicks in §2, so it is a genuine market rather than only our own noise. City is
the only handle historical data offers, so filtered figures are a **floor, not a measurement**. The
IP filter does the job properly from day zero forward, without the collateral damage.

### `/stats`: keep using it

The D1 table records no city or hostname, so it cannot be filtered retrospectively — but per the
table above it is ~95% clean already, so the garment, template and size breakdowns are trustworthy
today. The one caveat is unrelated to us: four cities produce 70% of all exports, so read the
totals as volume from a handful of power users, never as a headcount.

### The 29 August re-pull: compare like with like

Apply the clean segment to **both** windows. Comparing a filtered forward window against an
unfiltered historical one would show a collapse that is entirely an artefact of the filter, and
that mistake is much easier to make than to spot afterwards.

---

## 4. What the numbers rule in and out

| Option | Verdict at today's numbers |
|---|---|
| **Display ads** | **No.** 342 pageviews/mo × non-tier-1 RPM ≈ **under $1/month**, and ineligible for Mediavine/Raptive on the 12.5% tier-1 mix. Would also cost Core Web Vitals, which is the thing bringing the traffic. |
| **Affiliate** | **Yes, but as an option not an income.** ~1 day of work, no downside, no wedge damage. Expect ~$0/month now. |
| **Sponsorship** | Not sellable — no audience numbers to sell yet. |
| **Paid asset packs** | Against the wedge. PRODUCT-PLAN.md is right: the moment "free" gets an asterisk, the SEO and brand position collapse. Last resort. |
| **B2B / API** | **The only path whose revenue does not depend on fixing traffic.** See Track C. |

### Affiliate programs, for when it matters

| Program | Rate | Cookie |
|---|---|---|
| Printful | 10% for 12 months, + $25 per Growth-plan signup | 30 days |
| Gelato | up to 20% | 30 days |
| Printify | 5% for 12 months | 90 days |

A referred seller spending $500/mo on Printful is worth ~$600/year. At a $10 RPM that is the
equivalent of ~75,000 pageviews — which is the entire argument for affiliate over ads with a
commercial audience.

---

## 5. The plan — three tracks at different speeds

### Track A — Install affiliate now (~1 day)

Not because it earns today. Because it is cheap, compounds, and costs nothing to leave running.

1. Sign up for Printful, Printify and Gelato affiliate programs.
2. Ship a **post-export panel** — "Next: upload to your store" — at the moment of maximum intent.
   This is genuinely the user's next action, which is why it belongs there and why it does not read
   as an ad.
3. Add contextual links to the three POD-adjacent blog posts (`etsy-listing-photos…`,
   `batch-export…`, `mockup-vs-product-photography`).
4. FTC disclosure on every placement.

### Track B — Fix the constraint (this is SEO-PLAN.md, re-aimed)

1. **Push `/t-shirt-mockups-for-etsy`.** 52% of impressions, position 26, and an audience that is
   overwhelmingly US-based. Moving it to page 1 fixes traffic *and* the tier-1 geography in one
   move. Highest-leverage single page on the site.
2. **Stop optimising for "free t-shirt mockup generator."** Position 75 against Placeit is not
   winnable this year with title rewrites.
3. **Do Phase 4 of SEO-PLAN.md** — Product Hunt, AlternativeTo, directories. All still open, and
   these are exactly the sources AI assistants cite when recommending tools, so they feed Track B's
   best channel as well as classic SEO.
4. **Treat ChatGPT as the primary acquisition channel, because it already is.** 186 sessions and
   253 exports against Google organic's 18 and 0 (§1b). It is invisible in Search Console, so none
   of the SEO instrumentation sees it. Practical work: keep the comparison tables and the
   "free / no signup / no watermark" claims factual and easy to quote, and finish Phase 4 of
   SEO-PLAN.md. Product Hunt is already done and delivered 6 sessions and 0 exports as a traffic
   event — so the remaining value in Phase 4 is the *listings*, not launch-day spikes. AlternativeTo
   is the biggest one left. `producthunt.com` and `system.toolify.ai` both appear as referrers,
   which is the evidence that listing pages get crawled at all.
5. **Stop counting our own promotion as distribution.** Every `t.co` and `youtube.com` session is
   Mumbai metro. Those channels are not reaching the POD audience.

### Track C — The API (evaluate seriously)

The engine already exists: calibrated per-garment print areas, `pxPerIn`, placement projected in
print-area-relative coordinates, displacement-mapped on-model rendering, batch logic. Dynamic
Mockups sells exactly this from $15/mo on credits.

**20 B2B customers at $29/mo is $580/month** — more than Tracks A and B would produce at ten times
current traffic, and it does not need consumer volume at all.

Cost is real and should not be waved away: server-side rendering, billing, support, and a
different product surface from the free tool. It is a separate business that happens to share an
engine. But at 342 pageviews/month, waiting for consumer traffic is a multi-year bet.

### Re-evaluate at these thresholds

| Milestone | What it unlocks |
|---|---|
| 5,000 pageviews/mo + 40% tier-1 | Affiliate becomes real money |
| 25,000 pageviews/mo + 50% tier-1 | Display ads become eligible and worth the CWV cost |

---

## 6. Owner to-do list

Ordered. The first two gate everything else, because every number above is currently polluted.

- [x] **Set `?notrack=1` on every browser and profile used for testing** — done 2026-08-08.
- [x] **Activate the GA4 internal traffic filter** — done 2026-08-08, rule defined and the filter
      switched from *Testing* to **Active**.
- [ ] Sign up for the three affiliate programs (section 4).
- [ ] **Build the clean segment in GA4 Explore** (§3b) and save it. It makes the historical data
      usable and is required for a valid before/after at the end of the month.
- [ ] **Re-pull GA4 + GSC on or after 2026-08-29**, with the clean segment applied to *both*
      windows, and replace §1–2 with the results. Keep the old tables in the changelog rather than
      overwriting them — the difference between them is the size of our own footprint.
- [x] **Run the source/city/hostname Explore check** — done 2026-08-08, results in §1b.
- [ ] Compare GA4 `mockup_download` against `/stats` on the same window — the gap is the
      ad-blocker rate, which is itself an input to whether display ads could ever work.
- [ ] Product Hunt / AlternativeTo / directory submissions (SEO-PLAN.md Phase 4).

## Changelog

- **2026-08-08** — created. First analytics pull (GA4 90 days, GSC 7 weeks), tracking-contamination
  finding, three-track plan.
- **2026-08-08 (same day, corrected)** — withdrew the claim that the AI Assistant channel was
  genuine. Clicking our own links out of a Claude/ChatGPT session is filed under that channel, and
  local `npm run dev` browsing sends pageviews too. The whole GA4 channel mix is now marked
  unresolved pending one Explore check. The GSC baseline and the plan built on it are unaffected.
- **2026-08-08 (same day, third pass)** — added §3b after the owner asked how "everything before
  today is polluted" was actually being handled. It was not a handling strategy, it was a shrug: the
  blanket warning would have discarded usable history, and it wrongly swept Search Console in as
  well. Measured properly, sessions are ~40% ours and exports only 4.6%, so the two need different
  treatment. GA4 is recoverable with a segment; `/stats` was ~95% clean all along.
- **2026-08-08 (same day, resolved)** — ran the Explore check; added §1b. The AI channel is real
  and it is **ChatGPT** (184 sessions / 239 exports across ~130 cities); `claude.ai` sent 3 sessions
  and 0 exports, so the correction above was itself wrong. What is ours is **Mumbai metro, ~28% of
  traffic**, including all `t.co` and `youtube.com` referrals. Also found: ~62 sessions of
  datacentre bots, 36 on non-production hostnames, and 70% of all exports coming from four cities.
  ChatGPT now outranks Google organic 10:1 on sessions and produces every export Google does not.
