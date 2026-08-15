# HeroUI Design System Evaluation

**Date:** 2026-08-15
**Question:** Should TeeMockup adopt HeroUI as its design system?
**Recommendation:** **Don't install it — borrow from it.** Adopting the library means
adopting React and Tailwind (§3–4). But HeroUI's *design decisions* are portable to plain
CSS at zero runtime cost, and they solve real problems we have. See
[Options](#options) for the reject case and [§8](#8-borrowing-the-design-without-the-framework)
for what to take.

---

## 1. What we have today

Measured against the current tree (`7f27998`):

| Dimension | Current state |
| :--- | :--- |
| Framework | Astro 4.16, **no UI framework integration** — no React, Vue, Svelte |
| Pages | 35 `.astro` files (22 SEO landing/blog pages + editor + legal) |
| Styling | 3,922 lines of hand-written CSS across 3 files, **225 CSS custom properties** |
| CSS payload | 84 KB raw / **16 KB gzip** |
| Editor | `Editor.astro` — 4,068 lines, of which **3,517 are one inline `<script>`** |
| Editor JS | ~230 KB source / **~64 KB gzip** (incl. canvas engines) |
| DOM coupling | **162** `getElementById`/`querySelector` calls in the editor script |
| Framework JS shipped | **0 KB, on every page** |

The product's core value is canvas pixel work — `flatlay-engine.js`, `onmodel-engine.js`,
`selection-chrome.js` (996 lines combined) composite garments, relight designs, and draw
selection chrome. **None of that is component-library territory.** The DOM layer around it
is a control panel: 63 buttons, 20 inputs (6 range, 8 radio, 5 number, 2 file), 6 canvases,
2 modals, 3 tab groups, and a hand-rolled `CustomColorPicker` HSV class.

We already have a de facto design system — 225 tokens covering color, radii, transitions,
and glass surfaces. It's undocumented, but it exists and it's consistent.

## 2. What HeroUI v3 is, and what it costs to install

HeroUI v3 (`@heroui/react@3.2.4`, MIT, published 2026-08-07) is a ground-up rewrite of what
was NextUI. It's built on React Aria Components with Tailwind CSS v4, uses a compound
component API (`Card.Header`, `Select.Item`), needs no `<Provider>` wrapper, and moved all
animation to CSS with no JS animation runtime.

**Declared peer dependencies:**

```
react           >=19.0.0        tailwindcss          >=4.0.0
react-dom       >=19.0.0        react-aria-components ^1.20.0
react-aria      ^3.51.0         @react-aria/ssr       ^3.10.1
@react-aria/i18n ^3.13.1        @react-aria/utils     ^3.34.1
```

The library itself is genuinely lean — a full install is only 64 packages, and v3.0.3 dropped
~90% of its transitive dependencies. Subpath exports (`@heroui/react/button`) plus
`sideEffects: false` mean it tree-shakes properly. This is a well-engineered library. The
problem is not HeroUI's quality.

**The problem is that we don't run React, and HeroUI's floor is React.**

## 3. The cost, measured

I installed the full stack in a scratch project and bundled it with esbuild
(minified, `NODE_ENV=production`, gzip -9). Not estimates — measured bytes:

| Bundle | Raw | **Gzip** |
| :--- | ---: | ---: |
| React 19 + react-dom, rendering `<div>hi</div>` | 193 KB | **60 KB** |
| The above + the 15 HeroUI components the editor needs¹ | 620 KB | **185 KB** |
| HeroUI CSS — those 15 components only | 61 KB | **11 KB** |
| HeroUI CSS — full `heroui.min.css` | 413 KB | 38 KB |

¹ Button, Slider, Modal, Tabs, RadioGroup, Radio, NumberField, Select, Popover, Tooltip,
Card, ColorPicker, ColorArea, ColorSlider, Toast.

Read those numbers against the two surfaces:

**The 22 SEO landing pages.** These ship 0 KB of framework JS today. They are static
marketing content — headings, copy, images, links. HeroUI's floor is **60 KB gzip of React
before a single component renders**. There is no functional gain here whatsoever; the pages
would render identically. This is a pure Core Web Vitals regression on the surface the entire
business model depends on (`SEO-PLAN.md` is built around ranking these pages). Non-starter.

**The editor.** Today: ~64 KB gzip for *everything* — canvas engines, compositing, export,
batch ZIP, and the UI. With HeroUI: **185 KB gzip for the UI layer alone**, and the canvas
engines still have to ship on top of that, because HeroUI does not replace any of them. So
the editor's payload roughly triples to deliver the same features.

## 4. The cost that isn't bytes

**Tailwind v4 vs. 3,922 lines of existing CSS.** HeroUI requires Tailwind v4. We have 225
hand-authored tokens and a coherent glass-morphism aesthetic. Two ways forward, both bad:
run both systems in parallel (payload bloat plus two competing sources of truth for every
color and radius), or rewrite the styling of all 35 pages. The second is weeks of work whose
entire deliverable is "looks about the same."

**The editor's state lives in the DOM, not in a component tree.** 162 direct element lookups,
mutating classes and canvas contexts imperatively. HeroUI components are React — they own
their subtree. Dropping them into the current editor means either:

- Rewriting all 3,517 lines of editor script into React (a genuine rewrite, not a migration —
  and the riskiest possible refactor, since the canvas interaction code is where the product
  actually lives), or
- Running React islands beside vanilla code that mutates the same elements. This is the worst
  outcome: two ownership models fighting over one DOM, with React silently discarding
  outside mutations on re-render.

**Astro is not a first-class HeroUI target.** It works through `@astrojs/react`, but HeroUI's
guides target Next.js and Vite. We'd be off the documented path for SSR, hydration
boundaries, and CSS ordering.

**Release velocity.** 242 versions published; v3 shipped ~March 2026 and is on roughly
monthly minors (3.1.0 May → 3.2.4 Aug). A five-month-old ground-up rewrite is still settling.

## 5. The case *for* — and it's real

The editor has genuine accessibility gaps, and they're exactly the class of bug React Aria
eliminates. `design.md` (our own adopted Vercel Web Interface Guidelines) is violated in
several verified places:

| Gap | Evidence | HeroUI equivalent |
| :--- | :--- | :--- |
| **Modals have no keyboard behavior** | Both modals set `role="dialog" aria-modal="true"`, but there is exactly **1 `keydown` handler in the entire 4,068-line file** (on the batch drop zone). No Escape-to-close, no focus trap, no focus restore. | `Modal` — all three, free |
| **Color picker is mouse-only** | `CustomColorPicker` binds `mousedown`/`touchstart` on the SL and hue canvases. **No keyboard path exists** — the feature is unusable without a pointer. | `ColorArea` / `ColorSlider` / `ColorPicker` |
| **Tabs lack arrow-key navigation** | `role="tab"`/`tablist`/`aria-selected` are present, but there's no roving tabindex or arrow-key handling. | `Tabs` |
| **Focus rings are inconsistent** | 5 `focus-visible` rules in `global.css`; **0** in `landing.css` and `page.css`. | Built into every component |

These are real defects worth fixing. The question is whether they justify the price.

They don't — because **every one of them is fixable in vanilla JS.** A focus trap is ~30 lines.
Escape-to-close is ~5. Arrow-key tabs is ~20. Keyboard support on the color picker is the
biggest piece, maybe half a day (arrow keys adjusting H/S/V with `aria-valuenow` on a
`role="slider"` wrapper). Call it **2–3 days total** to close every gap in the table.

Paying 185 KB of gzip, a Tailwind migration, and an editor rewrite to avoid 2–3 days of
accessibility work is not a trade that makes sense.

## 6. Options

**A. Don't adopt the package — borrow the design. ← recommended**
Close the four issues in §5 directly, using HeroUI's patterns as the spec rather than
inventing our own, and adopt its token architecture in our existing CSS. Keeps 0 KB framework
JS on all 22 SEO pages. See §8 for the concrete list. ~3–4 days.

**B. Editor-only React island with HeroUI.**
Defensible in principle — the editor is behind a route boundary, so landing pages keep their
0 KB. But it requires rewriting 3,517 lines of DOM-coupled script, adds 185 KB gzip to the
editor, and introduces Tailwind alongside our CSS. Only worth it if the editor is being
rewritten in React *anyway*, for reasons that have nothing to do with the design system.

**C. Full adoption across the site.**
Reject. Ships 60 KB of React to 22 static content pages for zero functional benefit and
directly undermines the SEO strategy.

## 7. When to revisit

Re-open this evaluation if any of these become true:

- The editor is being rewritten in React for independent reasons (state complexity is a
  plausible future trigger — the script is already 3,517 lines).
- We need complex widgets that are genuinely expensive to hand-roll and keep accessible:
  combobox with async search, date pickers, virtualized tables, drag-and-drop lists.
- Multiple people start working on the frontend and per-component styling consistency
  becomes a coordination cost rather than a solo-author preference.
- HeroUI ships a first-class Astro guide and a no-React usage path.

Until then, the 225-token CSS system is the right tool: it's smaller, it's already written,
and it costs nothing to serve.

---

## 8. Borrowing the design without the framework

The library is MIT-licensed and its CSS ships as readable source, so its design decisions are
ours to take. Three tiers, in descending value-per-hour.

### Tier 1 — Interaction patterns (zero bytes, highest value)

These are behavioral specs, not code. HeroUI gets them right via React Aria; we can implement
the same behavior in vanilla JS and get the §5 defects fixed without shipping React. Using
their patterns as the reference means we're copying something proven rather than inventing:

- **Modal**: focus trap, Escape to dismiss, focus restore to the trigger on close, backdrop
  click-to-close, `aria-modal` with background inert.
- **Tabs**: roving tabindex — arrow keys move selection, Home/End jump to ends, only the
  active tab is in the tab order.
- **Color area / color slider**: arrow keys adjust saturation/value in 1% steps (shift = 10%),
  `role="slider"` with `aria-valuenow`/`aria-valuetext` on each axis. This is the fix for our
  pointer-only `CustomColorPicker`.
- **State vocabulary**: HeroUI styles from `[data-pressed]`, `[data-focus-visible]`, and
  `[aria-disabled]` attributes rather than ad-hoc classes. Worth adopting — it keeps the
  accessible state and the visual state as the same source of truth, so they can't drift.

### Tier 2 — Token architecture (our biggest consistency win)

Our 225 tokens are a flat list of hand-tuned literals. HeroUI's are a *system*, and three of
its ideas fix problems we measurably have:

**Semantic foreground/background pairs.** Every surface token has a matched foreground:
`--surface` / `--surface-foreground`, `--accent` / `--accent-foreground`. Contrast can't get
mismatched because the pair travels together. Ours are unrelated tokens (`--bg-card` and
`--text-primary` have no declared relationship).

**Derived values instead of literals.** HeroUI defines one `--radius: 0.5rem` and derives
`--field-radius: calc(var(--radius) * 1.5)`. We hardcode three unrelated radii.

**`color-mix()` for state variations — the big one.** HeroUI writes
`color-mix(in oklch, var(--foreground) 15%, transparent)` instead of a hand-tuned literal.
Our CSS contains **78 hardcoded `hsl()`/`hsla()` literals outside `:root`, and 37 of them are
the brand primary `197 95% 48%` restated at a different alpha**:

| Literal | Occurrences |
| :--- | ---: |
| `hsla(197, 95%, 48%, 0.2)` | 8 |
| `hsla(197, 95%, 48%, 0.05)` | 6 |
| `hsla(197, 95%, 48%, 0.4)` | 5 |
| `hsla(197, 95%, 48%, 0.1)` | 4 |
| `hsla(197, 95%, 48%, 0.07)` | 4 |

Changing the brand color today means editing 37 places and hoping none are missed. With
`color-mix(in oklch, var(--primary) 5%, transparent)` it's one edit. This is a contained,
mechanical refactor with an immediate payoff.

Also worth lifting verbatim: explicit state tokens `--disabled-opacity: 0.5`,
`--cursor-disabled: not-allowed`, `--ring-offset-width: 2px`.

### Tier 3 — The per-component local-variable pattern

The single best idea in their CSS. A component declares its own local variables, defaulting
down a chain, and the base rule reads only those:

```css
.button {
  --button-bg: transparent;
  --button-bg-hover: var(--button-bg);      /* falls back to base */
  --button-bg-pressed: var(--button-bg-hover);
  background-color: var(--button-bg);
}
```

Variants then override *only* the locals — never the layout, never the transitions. Compare
our `.garment-card`, which repeats a full property block for each state:

```css
.garment-card:hover  { border-color: var(--primary); transform: translateY(-2px);
                       background: hsla(197, 95%, 48%, 0.05); }
.garment-card.active { border-color: var(--primary);
                       background: linear-gradient(135deg, hsla(...), hsla(...)); }
```

`.garment-card`, `.prop-card`, `.swatch-tab`, and `.batch-tab` are four near-identical
selectable-card components with four independently maintained hover/active blocks (21 `:hover`
and 16 `.active` rules in `global.css`). The local-variable pattern collapses them to one base
plus a few token overrides.

### Also worth copying, specifically

- **Focus ring recipe** — `--focus: var(--accent)` at 2px with a 2px offset; in plain CSS,
  `outline: 2px solid var(--focus); outline-offset: 2px`. Apply on `:focus-visible`
  site-wide, which closes the `landing.css`/`page.css` gap (0 focus rules today).
- **Press feedback** — `transform: scale(0.97)` on `:active`, 250ms. Cheap, and it makes the
  editor's 63 buttons feel responsive.
- **Backdrop motion** — fade in 150ms, out 100ms. Asymmetric on purpose: dismissal should
  feel faster than appearance.
- **A real bug they document**: `motion-reduce` must come *after* the `transition` declaration
  or specificity lets the transition win and `prefers-reduced-motion` silently breaks. Our
  `--transition-smooth` has no reduced-motion handling at all, which `design.md` §4 requires.
- **BEM naming** — `.modal__backdrop`, `.modal__backdrop--blur`. Optional, but it would give
  our 3,922 lines a naming convention they currently lack.

### What is *not* borrowable

The component CSS source uses Tailwind's `@apply` (`@apply relative isolate inline-flex h-10
…`), so it cannot be copy-pasted — read it as a spec, not as source. The compiled
`heroui.min.css` is plain CSS but it's 413 KB of minified output for 75+ components; it's
reference material, not something to vendor. Their colors are OKLCH and ours are HSL, so
values need converting — though adopting OKLCH is itself worth considering, since it's what
makes `color-mix` derivations stay perceptually even across hues.

### Suggested order

1. `color-mix` refactor of the 37 duplicated primary literals — mechanical, no visual change,
   immediately makes rebranding a one-line edit.
2. Site-wide `:focus-visible` ring + `prefers-reduced-motion` guard — closes two `design.md`
   violations across all 35 pages.
3. Modal keyboard behavior (trap, Escape, restore) — the most serious accessibility defect.
4. Color picker keyboard support — the largest single piece, roughly half a day.
5. Local-variable refactor of the four card/tab components — cleanup, do last.

Steps 1–4 are the substance; each is independently shippable.

---

## Appendix: reproducing the measurements

```bash
mkdir heroui-probe && cd heroui-probe && npm init -y && npm pkg set type=module
npm i react@19 react-dom@19 @heroui/react react-aria react-aria-components \
      @react-aria/ssr @react-aria/i18n @react-aria/utils esbuild

# baseline.jsx renders <div>hi</div>; editor.jsx imports the 15 components in §3 note 1
for f in baseline editor; do
  ./node_modules/.bin/esbuild $f.jsx --bundle --minify --format=esm --platform=browser \
    --define:process.env.NODE_ENV='"production"' --outfile=$f.js
  gzip -9 -c $f.js | wc -c
done
```

Peer dependencies read from `registry.npmjs.org/@heroui/react/latest`; release dates from the
registry `time` map. Current-site figures measured directly against `src/`.

**Sources:**
[HeroUI v3 Lands as a Ground-Up Rewrite (InfoQ)](https://www.infoq.com/news/2026/07/heroui-v3-rewrite/) ·
[@heroui/react on npm](https://www.npmjs.com/package/@heroui/react) ·
[heroui-inc/heroui](https://github.com/heroui-inc/heroui) ·
[HeroUI releases](https://heroui.com/en/docs/react/releases)
