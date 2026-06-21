# Vercel Web Interface Guidelines

This reference document outlines the Vercel Web Interface Guidelines for creating polished, accessible, and performant user interfaces.

---

## 1. Accessibility

- **Icon-only buttons:** Must have an `aria-label` attribute (e.g., `<button aria-label="Close">`).
- **Form controls:** Need a corresponding `<label>` (using `for` or wrapping the input) or an `aria-label`.
- **Keyboard handlers:** All interactive elements must support keyboard controls (e.g., matching `onKeyDown` / `onKeyUp` actions).
- **Semantics:** Use `<button>` for action triggers, `<a>` for navigation links. Never use a `div` with an `onClick` listener.
- **Images:** Must include `alt` tags (use `alt=""` for purely decorative images).
- **Decorative icons:** Hide decorative graphic elements from screen readers using `aria-hidden="true"`.
- **Async Updates:** Real-time updates like toasts, alerts, and live validations must use `aria-live="polite"`.
- **Semantic HTML first:** Prioritize native HTML5 elements (`<button>`, `<a>`, `<label>`, `<table>`) over ARIA attributes where possible.
- **Headings:** Maintain hierarchical structure (`<h1>`–`<h6>`) and include a skip link to the main content.
- **Anchor Scroll:** Apply `scroll-margin-top` to heading elements referenced in page links.

---

## 2. Focus States

- **Visual Indicators:** Interactive items must have high-visibility focus states (e.g., using `:focus-visible` ring indicators).
- **No Invisible Focus:** Never set `outline: none` or `outline-none` without providing a distinct focus alternative.
- **Selective Focus Ring:** Prefer `:focus-visible` over `:focus` to prevent showing outlines on click interactions.
- **Compound Controls:** Group focus interactions using `:focus-within` selectors.

---

## 3. Forms & Inputs

- **Identification:** Form inputs must have standard `autocomplete` and descriptive `name` attributes.
- **Input Type:** Use accurate input types (`email`, `tel`, `url`, `number`) and correct `inputmode`.
- **Clipboard:** Do not prevent users from pasting into input fields (never call `preventDefault` on paste events).
- **Click Targets:** Labels must be clickable. Checkboxes and radio buttons should share a single hit target with their labels (no dead zones).
- **Form Submission:** Keep submit buttons active until the network request starts, then replace with a loading indicator.
- **Validation Errors:** Show errors inline next to the affected inputs, and focus the first invalid input on submission.
- **Placeholders:** End placeholder text with an ellipsis `…` and show an example format.
- **Autofill Security:** Set `autocomplete="off"` on non-authentication fields to avoid password manager triggers.
- **Unsaved Changes:** Warn users before they navigate away with unsaved changes.

---

## 4. Animation

- **Motion Reduction:** Honor the system-level `prefers-reduced-motion` settings.
- **Performance:** Limit CSS animations to `transform` and `opacity` to keep them compositor-friendly.
- **Explicit Transitions:** Do not use `transition: all`. List animated CSS properties explicitly.
- **Transforms:** Set correct `transform-origin` parameters. For SVGs, apply transforms to a `<g>` wrapper with `transform-box: fill-box; transform-origin: center`.
- **Interruptible Animations:** Ensure all UI animations respond to user inputs immediately mid-motion.

---

## 5. Typography

- **Ellipsis:** Use the single-character ellipsis `…` instead of three periods `...`.
- **Curly Quotes:** Prefer curly quotes `“` `”` over straight quotes `"`.
- **Non-breaking Spaces:** Place non-breaking spaces `&nbsp;` between numbers and units (e.g., `10&nbsp;MB`), shortcut combos (e.g., `⌘&nbsp;K`), and brand names.
- **Loading states:** Always append the ellipsis character (e.g., `"Loading…"` or `"Saving…"`).
- **Numbers:** Apply `font-variant-numeric: tabular-nums` for numeric comparisons, tables, and statistics.
- **Widows:** Apply `text-wrap: balance` or `text-pretty` on heading elements.

---

## 6. Content Handling & Performance

- **Text Truncation:** Ensure text containers handle overflow gracefully using `truncate`, `line-clamp`, or `break-words`.
- **Flex Items:** Apply `min-w-0` to flex-box child items to allow text truncation.
- **Empty States:** Provide visual fallbacks and handle empty arrays/strings cleanly.
- **Layout Thrashing:** Avoid layout-reading properties (`getBoundingClientRect`, `offsetHeight`, `scrollTop`) during paint operations. Batch DOM reads and writes separately.
