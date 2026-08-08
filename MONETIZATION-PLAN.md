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

On its face this says AI assistants are 29% of sessions and 77% of exports. **Do not act on that
yet — the channel is very likely us.** Clicking a link to the site from inside a Claude or ChatGPT
conversation sets the referrer to `claude.ai` / `chatgpt.com`, which GA4 files under *AI Assistant*
rather than *Direct*. This repo has been worked on through Claude Code sessions across PRs #33–#39,
and 169 sessions over 90 days is ~1.9/day — a working cadence, not a discovery curve. 80.6s
engagement with 1.4 exports per session is what "open the editor and test an export" looks like.

Treat the whole channel table as unresolved until the check in §3 is run.

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

**Assessment.** Treat the entire GA4 baseline as unusable for decisions until it is re-measured.
An earlier draft of this doc claimed the AI Assistant channel was "real, and not us" — that was an
assumption, not a finding, and it was wrong to state it as one. Every large channel here has a
plausible explanation that is us: Direct looks like localhost dev sessions, AI Assistant looks like
links clicked out of Claude Code sessions, and Unassigned's 197.6s / 3.4-exports-per-session
profile is not a stranger's behaviour.

**The one test that resolves it.** GA4 → Explore → blank exploration. Dimensions **Session
source/medium**, **City** and **Hostname**; metric Sessions. That single view separates
`claude.ai / referral` from `chatgpt.com` and `perplexity.ai`, shows whether the traffic comes from
one city or many, and splits `localhost` from `freeteemockup.com` — answering all three questions
at once.

**What does not depend on any of this.** Search Console is immune — clicking a link in a chat does
not create a Google Search impression. The 8 clicks, 166 impressions and 12.5% tier-1 mix in §2 are
clean, and they are what rules out display advertising. The §5 plan stands on the GSC data alone.

**Neither tracking fix is retroactive.** See the owner to-do list in section 6.

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
4. **Resolve the AI channel before investing in it.** It *looks* like ~6× Organic Search and is
   invisible in Search Console, but it is very likely our own link-clicking out of Claude Code
   sessions (§3). Run the Explore check first. If a real slice survives, it is worth pursuing —
   Phase 4's directory and Product Hunt work feeds it either way, so that work is safe to do now.

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

- [ ] **Set `?notrack=1` on every browser and profile used for testing** — visit
      `https://freeteemockup.com/editor?notrack=1` once each. The console confirms the state.
      Stops our exports counting in GA4 *and* `/stats`.
- [ ] **Activate the GA4 internal traffic filter.** Admin → Data streams → the stream → Configure
      tag settings → **Define internal traffic** (add your IP), then Admin → Data settings →
      **Data filters** → switch "Internal Traffic" from *Testing* to **Active**. It is created
      inactive by default, which is easy to miss. Stops our pageviews counting.
- [ ] Sign up for the three affiliate programs (section 4).
- [ ] Re-pull GA4 + GSC three weeks after the two fixes above and replace sections 1–2 with clean
      numbers.
- [ ] **Run the source/city/hostname Explore check (§3)** to find out how much of Direct, AI
      Assistant and Unassigned is us. Do this before any strategy is built on the channel mix.
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
