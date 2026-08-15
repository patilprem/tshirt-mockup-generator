# HeroUI Design System Evaluation

**Date:** 2026-08-15
**Question:** Should TeeMockup adopt HeroUI as its design system?
**Recommendation:** **No — not now.** Fix the specific accessibility gaps by hand instead
(~2–3 days of work). Revisit only if the editor gets rewritten as a React app for
independent reasons. See [Options](#options) for the full reasoning.

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

**A. Don't adopt. Fix the gaps by hand. ← recommended**
Close the four issues in §5 directly. Optionally document the existing 225 tokens as a real
design system (`design-tokens.md`) so the implicit system becomes explicit. Keeps 0 KB
framework JS on all 22 SEO pages. ~2–3 days.

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
