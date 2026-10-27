# PT Catch design guide

How ptcatch.com looks, reads and behaves, written so changes stay consistent. It is grounded in
[Unity Editor Foundations](https://www.foundations.unity.com/) and adapted to a small, dark community website.

**How to use it:**
- Read §1.
- Use §2–§12 while building.
- Run §13 before committing UI.
- §14 lists where the code still breaks the guide; fix those when you're in the file anyway.

Tokens and classes named here are the real ones, in `assets/css/site.css`, `assets/css/ambience.css` and
`assets/js/core/ui.js`.

**Already decided by the user.** The guide builds on these and never overrides them:
- English only.
- Dark, flat and sleek, with small radii.
- The Rosa accent (`--accent: #ff6b89`), with one job per colour.
- The Dan ladder glyphs are the mark, with faint gold for the named stages.
- The Unbounded "PT Catch" wordmark. Fonts are self-hosted.
- Background tiles only in the side margins, with grain and no glows.
- Rank-first stat tiles, sentence-case labels, fewer boxes. Less is more.
- A star-range slider with a single Rosa fill.
- The "legend" and "inactive" tags keep a small outline, centred on the name.
- Challenges' four modes are tabs, each with its live figure, not cards.

---

## 1. Principles

These adapt Foundations' usability principles (*Getting Started*: users first, driving alignment, authentically
Unity) and its visual rules (*Color Palette*, *Content Organization*, *Interactions*).

1. **Players first.** Every view answers a player's question: where do I stand, who's ahead, what's new, what can I
   play. Data comes before decoration and before explanation.
2. **One vocabulary.** Reuse the tokens and helpers (`stat()`, `scoreRow()`, `tabs()`, `chipGroup()`, `pageHead()`)
   instead of one-offs. Foundations' shared language for designers and engineers is, here, `site.css` and `ui.js`.
3. **A box means an object.** In Foundations a container signals that something can be clicked, dragged or acted on
   as a group. Group everything else with space, a hairline and a heading.
4. **One job per colour.** Keep the palette small and muted, and never let colour be the only signal.
5. **One loud thing per view.** One hero per page: the rank, the map cover, who's on top. Everything else steps down
   in size or colour, not into a box.
6. **Ours, not a template.** Identity comes from the Dan glyphs, osu! covers and the Discord's real in-jokes, not from
   slogans, gradients or glass. "Authentically Unity" becomes "authentically PT Catch".
7. **Accessible by default.** Contrast, focus, keyboard access and target size are requirements, not polish.

---

## 2. Colour

*Sources: Color Palette (variables, flat design, base layers), Accessibility (semantic colour, contrast).*

Foundations styles everything through named variables that read role, then part, then state
(`--unity-colors-button-text-hover`). We keep short names but use the same order (`--accent-hover`, `--accent-bg`).
**No hex or rgb values outside `:root`.** If a colour has a job, it gets a token.

### Layers

Depth comes from layers, dark to light, not from shadows.

| Token | Job |
|---|---|
| `--bg-2` #1b1617 | Recessed: table headers, feed day bars, text fields |
| `--bg` #1f191b | The page |
| `--surface` #282022 | Objects: tables, row lists, banners, menus, game options |
| `--surface-2` #32282b | Hover on objects and rows, secondary buttons, popovers |
| `--surface-3` #3e3336 | Button hover, image placeholders, tracks |

### Lines

| Token | Job |
|---|---|
| `--border` #372c30 | Hairlines between sections and rows; edges of objects |
| `--border-strong` #4c3e42 | Edges of controls, menus and badges; unlit Dan glyph outlines |
| `--input-border` #806e73 | Edges of anything you type into (3.6:1 on `--bg`) |

### Text

| Token | Contrast on `--bg` | Job |
|---|---|---|
| `--text` #f4ebee | 14.8:1 | Content and values |
| `--text-dim` #c1b3b7 | 8.6:1 | Secondary: labels, subtitles, the rest of a score line |
| `--text-faint` #a09095 | 5.7:1 (4.7:1 on `--surface-2`) | Tertiary: timestamps, units, table headers, placeholders. Nothing lighter than `--surface-2` behind it |

### Colours with one job each

| Token | Its one job | Never for |
|---|---|---|
| `--accent` family (`-hover`, `-bg`, `-line`, `-ink`) | **Act or current:** links, the primary button, the active tab, selected chips, the focus ring, "you" rows (`.me`), a chart's single series | Headings, slogans, decoration, categories |
| `--gold` | **Honours:** #1, Hebrew Dan stages, badges and roles, the throne | Warnings, general highlight |
| `--silver`, `--bronze` | #2 and #3 where podiums matter | Anything else |
| `--red`, `--red-bg` | **Wrong or missed:** misses, wrong answers, errors, always next to text | "Hot" or "new", decoration |
| `--cat-c` / `--cat-u` / `--cat-r` | **Map category**, as the 7px square before the word (`.cat`) | Text colour, fills, other meanings |

**osu!'s data colours** stay as they are because players already know them, but keep them small and give them no
other job:
- mod pills (`.mod-*`);
- grade letters (`.grade-*`);
- the star spectrum (`starColor()`).

This mirrors Foundations' fixed semantic set (red for error, green for success, yellow for warning).

**Rules:**
- **Colour is never the only signal.** A miss shows ✕ and a count. A pressed chip has `aria-pressed`. Links in running
  text are underlined.
- **Contrast** is at least 4.5:1 for text and 3:1 for control edges, icons, focus rings and chart marks. Check the hex
  values, not a picked pixel.
- **Translucent layers:** text on the frosted `.topbar` or `.nav-menu` must pass against the worst background behind
  it.

---

## 3. Typography

*Sources: Typography (a deliberately small scale, alignment, indentation), UI Writing Guide (capitalisation),
Accessibility (minimum size, italics).*

Foundations limits the Editor to six sizes so it stays coherent. The web needs bigger text (Unity's body text is 12px,
ours is 15px), but the same restraint applies.

### Families

| Family | Use for |
|---|---|
| Inter (`--font`) | All text and every number (tabular figures are on for the whole `body`) |
| Josefin Sans (`--display`) | H1, H2, Dan glyphs, years, step numbers |
| Unbounded 800 | `.brand` only. The file is subset to "PT Catch"; re-make it if the name changes |
| `--mono` | Bot commands and `.kbd` |

No fourth family, and no body text or slogans in the display face.

### Scale

There are no in-between sizes.

| Token | px | Role |
|---|---|---|
| `--fs-xs` | 12 | The floor: chart axes, tags, tab counts. Short runs only |
| `--fs-sm` | 13 | Secondary text: score lines, labels, menus |
| `--fs-md` | 15 | Body, table cells, buttons |
| `--fs-lg` | 17 | Lead paragraphs, the pp in a score row, `kv` values |
| `--fs-xl` | 20 | Small section headings |
| `--fs-2xl` | 26 | The big number (stat tiles, hero stats) |
| `--fs-3xl` / `--fs-4xl` | 36 / 48 | Duel values; the hero H1 or a result, once per page |

**Rules:**
- **Levels** differ in at most two of size, weight and colour.
- **Weights:** 400 for body, 500 for labels, 600 for emphasis and buttons, 700 for numbers and headings, 800 only for
  big result numbers. Don't bold a label just to group things (*Content Organization*).
- **Alignment:** left everywhere. Button labels, empty states and the duel or scoreboard figures are centred. Number
  columns (`td.num`) are right-aligned.
- **Case:** sentence case for every heading, label, button, tab and menu item. No uppercase or letter-spaced labels;
  table headers (`th`) are the one existing exception. Acronyms stay as they are (PT, SS, HDDT, pp, FC). Foundations'
  writing guide prefers title case for Editor labels, but its Button page asks for sentence case. The user chose
  sentence case.
- **Italics:** only the one-line event quip.
- **Truncation:** end-truncate titles with an ellipsis, and keep the full string in the accessible name or `title`.
- **Line length:** under about 75ch for running text.

---

## 4. Spacing and layout

*Sources: Content Organization (group with spacing: 2px within a group and 8px between groups; containers last),
Windowing (adapt to size, avoid two scrollbars).*

### Spacing scale

They are tokens in `:root`, and every padding, margin and gap uses them.

| Token | px | Typical use |
|---|---|---|
| `--sp-1` | 4 | Icon to text; chip to chip |
| `--sp-2` | 8 | Items in a group (buttons in `.btn-row`) |
| `--sp-3` | 12 | Padding inside small controls and rows |
| `--sp-4` | 16 | Page gutter; padding inside objects; `.grid` gaps |
| `--sp-6` | 24 | Between groups in a section |
| `--sp-8` | 32 | Under the page head |
| `--sp-12` | 48 | Between sections |

**Rules:**
- The space between groups is at least twice the space within one, as with Foundations' 2px versus 8px.
- Neighbouring objects share the same inset.
- No inline `style=""` in page JS; add a class.
- **Px only where it isn't spacing:** 1–3px optical nudges (a baseline, a pill's border), offsets that cancel another
  value (a bleed of `-16px` under a 16px inset), and sizes that come from geometry (the 72px row indent under a map
  cover, the jersey's 170px, the hamburger's line spacing). Everything else is a step.
- **Which step:** icon or dot to its text `--sp-1`; items in a group `--sp-2`; padding inside rows and small controls
  `--sp-3`; the inset of objects (tables, row lists, menus, toasts, cards) `--sp-4`; between groups `--sp-6`; under
  a head or between blocks `--sp-8`.

### Grid

- **Column:** `--page` is 1180px, centred, with 16px gutters. Only the azulejo tiles sit outside it, kept 140px clear
  of the text.
- **Grids:** reuse `.grid-2/3/4` (2 columns under 900px, 1 under 620px) and `.grid-auto` before writing a new one.
- **Breakpoints:** 480 (small phone), 600 (tables fold, `.col-opt` hides), 760 (layouts stack) and 940 (the nav
  becomes a menu). Don't add others.
- **No sideways page scroll on phones.** Only `.table-wrap` and the `.diffs` strip may scroll sideways, and never both
  ways at once.
- **No box inside a box.**

---

## 5. Shape, borders and elevation

*Sources: Color Palette (flat design, accented borders, base layers), Interactions (rounded corners and containers
signal interactivity).*

### Radii

Never above 5px, and no pill-shaped buttons.

| Radius | Use for |
|---|---|
| `--r` 5px | Objects and controls: `.btn`, `.input`, `.table-wrap`, `.rows`, `.banner`, menus |
| `--r-sm` 3px | Small controls: `.chip`, `.badge`, `.diff`, `.map-cover`, `.kbd` |
| `--r-xs` 2px | Pills inside text: `.mod`, `.pos`, `.stars` |
| 50% | People (avatars) only. Maps are rectangles |
| 0 | Open sections: `.card:not(.card-link)`, `.stat`, `.notice`, `.empty` |

### Containers

- **A full box** (fill, 1px border, radius) is for one object: a table, a row list, a banner, a game option, a Dan
  stage or a menu.
- **Everything else is open:** a `--border` hairline above it or between its items.
- **No coloured `border-left` callouts.** The 2px inset accent edge on `.me` rows stays, because it marks a state.
- **Inputs are inset:** a `--bg-2` fill and an `--input-border` edge. **Actions are outset:** a `--surface-2` fill and
  a `--border-strong` edge. These are Foundations' inset and outset borders.

### Elevation

- **On the page:** no shadows.
- **Floating layers** (popovers, toasts, the toggletip bubble) may have one neutral black shadow: `--shadow-float`.
- **No glows:** no coloured shadows, `text-shadow` halos or gradient surfaces.
- **Translucency:** the frosted top bar and its menus are the only translucent surfaces.

---

## 6. Iconography

*Sources: Iconography (simple glyphs on a 16px grid, one neutral colour unless the colour means something), Label and
Tooltip (every icon has a name; avoid icons in buttons).*

### The Dan ladder is the mark

- **Lit numerals** are `--text`. **Lit Hebrew stages** are `--gold`.
- **Unlit stages** are a 1px `--border-strong` outline. Hebrew stages use a solid 30–35% gold instead, because their
  system font's contours show through an outline.
- **The highest stage reached** gets a 2px accent rule under it.
- **Where it appears:** `.rung` on home, `.dan-stage`, the profile `.jersey`, the `.climb` loader and `.lost-glyph`.
- Use the glyphs for Dan things only.

### Other icons

- **The logo** (`logo.svg`, 32px beside the wordmark) is never recoloured.
- **Functional icons** are inline SVG, 16px, `currentColor`, 1.5–2px stroke (the search icon is the model). Only use
  them for universal meanings: search, compare (⇄), close, disclosure.
- **Characters** (★, ✕, ✓) are text beside a number or word.
- **Icon-only controls** need an `aria-label` and a visible name. On phones prefer a word, as the "Search" toggle does.
- **No icons inside text buttons** unless the action needs one.
- **No emoji in the interface.** They belong in opt-in easter eggs and in text copied to Discord.
- **No arrows after link text.**

---

## 7. Motion

*Sources: Accessibility (no flashing, the right loader), Tooltip (0.4s delay), Selection History (the updated
highlight is enough feedback; no intrusive animation).*

Foundations has no motion page, but its guidance is consistent: motion confirms a change and never performs.

| Kind | Duration | Examples |
|---|---|---|
| State change (colour, border, fill) | 120ms, `ease` | Buttons, chips, `.card-link`, inputs |
| Small movement (4px or less); a menu opening | 120–200ms | `.nav-menu`, `.peek-pop` |
| Hover intent before a menu opens | 80–100ms delay | `.nav-cat`, `.peek` |
| Arrival, once | 550ms, `cubic-bezier(.2, .7, .2, 1)` | `.reveal` sections below the fold |
| Transient message | 6s (the `toast()` default), then fade | Toasts |

**Rules:**
- Animate only `opacity`, `transform` and colour; never layout.
- **One change per hover:** colour or fill. Not that plus a lift and a shadow.
- **Only loading loops** (`.climb`). No pulses, shimmers or breathing glows. Easter eggs are opt-in and play once.
- **Reduced motion:** every animation has a `prefers-reduced-motion: reduce` rule next to it. JS uses
  `reducedMotion()` and `scrollBehavior()`.
- **Nothing shifts the page:** reserve space while loading (`placeholderRows()`, `main#content { min-height }`).

---

## 8. States

*Sources: Interactions (states; hiding versus disabling; invalid entry), Empty States, Errors and Messaging, Progress
Bar.*

| State | Look | Rule |
|---|---|---|
| **Hover** | Actions: the fill moves up one layer. Inputs: the border lightens. Links: underline. Title links: accent | This follows Foundations (lighter fill for actions, lighter border for inputs). Never the only cue |
| **Focus** | `:focus-visible`: a 2px accent outline at a 2px offset. Inputs: an accent border | Distinct from hover, never clipped by a parent. No ring on the H1 that the router focuses |
| **Pressed or checked** (a toggle that stays on: `.chip.active`, `.btn[aria-pressed]`, `.fun-chip`) | `--accent-bg` fill, `--accent-line` edge, accent text; buttons add ✓ | Always with `aria-pressed` |
| **Current or selected** (`.tabs a.active`, `.nav-top.active`, `.diff[aria-current]`, `.dan-stage.selected`) | Tabs and nav: a 2px accent underline. Objects: an accent border on `--accent-bg` | Always with `aria-current` |
| **You** (`.me` rows) | `--accent-bg` and a 2px inset accent left edge | Only the player marked "This is me" |
| **Disabled** | `opacity: .45`, no hover change | Hide a control that rarely applies. Disable one that's usually there, and say why in visible text. Never hide buttons |
| **Invalid input** | Number fields keep the last valid value | No red borders while typing |

### Empty

Centred, between hairlines (`.empty`), with one or two sentences, at most one button and no error styling. An empty
list isn't a failure. There are three kinds:
- **Blank** (nothing matched): `emptyFiltered()` with "Clear filters".
- **Idle** (nothing chosen yet): "Pick a player to compare".
- **Day zero** (never used): one line of invitation and one action.

### Loading

- Use the indeterminate `.climb` loader and placeholder rows at their real height.
- Never show something that looks like a progress bar for an unknown wait.
- The text is "Loading…", never a joke (§12).
- Announce the result with `announce()`.

### Error

- Write the **problem, then the cause, then the fix:** "This player isn't tracked yet. The bot adds players when they
  join the Discord. Check the link or search for them."
- Never start with "Error", and never lead with a raw message or HTTP code.
- Use `--red` only next to text.
- Choose the form by scope:
  - The whole page failed: an error page.
  - One section failed: an inline line in its place (as in the profile's "Couldn't load all plays").
  - Brief feedback: a toast.

---

## 9. Components

*Sources: the matching Foundations component pages (Button, Toggle, Radio Button, Tab, Dropdown, Slider, List and
Multi-column Views, Label, Help Box, Tooltip, Search Field, Text Field, Foldout).*

### Buttons (`.btn`)

- **Sizes:** 36px, `.btn-small` 30px, `.btn-icon` 30px square.
- **`.btn-primary`:** at most one per view.
- **`.btn-discord`:** only for the invite, and never beside a primary button.
- **`.link-button`:** an action that looks like a link.
- **Labels:** one line, one to three words, starting with a verb ("Join the Discord", "Clear filters"), with no end
  punctuation. Add "…" only when more input follows.
- **Order:** primary first, then secondary; destructive actions sit apart.
- **Toggles** that stay on, like "This is me", use `aria-pressed`.

### Links

- Accent and not underlined in navigation and lists. Underlined in running text.
- The text names the destination, and the same destination always gets the same text.
- Never "click here".

### Chips (`.chip`, `chipGroup()`)

- Filters: a labelled group of toggle buttons for five or fewer options that should all be visible. Use a `.select`
  for more.
- A chip that only shows a value is a `.badge`.

### Tabs (`tabs()`)

- Tabs switch between sibling views of one thing. They are real links with `aria-current` and an optional `.count`.
- The `.count` is a number, or a short live figure where the views are challenges: Challenges shows "5d left", "10th
  Dan", "30" (#1s up for grabs) and "79.3%", so each tab says where it stands before you open it.
- One or two words, at most about six tabs, and no heading repeating the tab name.
- Tabs are spaced by a gap, not padding, so a strip that wraps on a phone starts every line at the left edge.
- If the views need comparing side by side, use columns instead.

### Menus (`.nav-menu`, `.you-menu`, `.peek-pop`, `.search-pop`)

- **Position:** attached to the thing that opened it, never covering it.
- **Opening:** on click or tap (desktop nav: after a short hover pause).
- **Closing:** on Escape, a click outside, losing focus, or a choice.
- **Structure:** one level, no sub-menus. Hover is `--surface-2`; the current item is the accent.

### Star-range slider (`.range`)

- Two thumbs and one track, with a **single Rosa fill** for the chosen range.
- The value reads out as text (`.range-out`), with a reset link once the range is changed.
- **Thumbs** are 18px, `--text`, with an extra accent ring on focus.
- **Hit area:** the whole strip, 44px tall on phones. Arrow keys step the focused thumb.
- A slider sets one linear quantity. Where precision matters, pair it with a number field.

### Tables and score rows

- **Tables** (`.table-wrap`):
  - Small, faint headers on `--bg-2`; numbers right-aligned.
  - Rows get a `--surface-2` hover.
  - Under 600px, `.col-opt` columns fold into `.cell-sub`.
- **Score rows** (`scoreRow()`):
  - **One number leads:** pp, `--fs-lg`, 700, on the right.
  - The rest is one dim run: grade, accuracy, combo, misses or FC.
  - Mods only when not nomod. The category square only on mixed lists.
  - Position as faint text, gold only for #1. The time is last and faint.
  - No pills except where osu! uses them (mods, stars).
- **Marks:** `.me` for your rows, `.target` for a linked row.

### Stat tiles (`stat()`)

- **Rank first:** the value is the PT rank with a small `.stat-unit` "PT", and the subtitle carries the pp and global
  rank.
- **Layout:** one open strip split by hairlines, not boxes, with rows aligned via subgrid.
- **Label:** a sentence-case noun phrase in `--fs-sm`, dim.
- **Value:** `--fs-2xl`. It shrinks to fit (`.stat-fit`) and never wraps.
- A value that links to its leaderboard uses `.stat-link`.
- At most one strip of four to six tiles per page, with the hero first.

### Community goals and progress

A goal the whole community works toward (the Dan course, the completion goal) is shown as **one band**: a mark of how
far Portugal has got, then a one-line caption.
- **The mark** is the ladder's glyphs (`ladderBand()`) or a figure on a thin meter (`.goal-line`: the share in
  `--fs-2xl`, then a 4px `.goal-bar`, accent for the done part only). The mark is one link to the goal's page.
- **The caption** (`.hero-caption`) starts with a bold lead-in naming the goal, gives the count in plain words, and ends
  with one link ("See what's left", "Open the Dan course").
- **Meters only for known totals** (§10), never a percentage without its "x of y" in text beside it.
- **The goal's own page** has the big result (`.goal-figure`, `--fs-4xl`). Anywhere else the figure stays at stat-tile
  size, so it never competes with that page's hero.
- **A nudge** ("what to play next for it") is an open list of at most three map lines under a sentence-case heading,
  with a link to the full list. No box, no button.

### Home page

The home page answers, in order: who we are, how far we've got, who's on top, what to play, what's happening. One
hero, then sections that step down.
1. **Hero:** H1, one lead sentence, the actions and the stat strip (`.hero-stats`). Under it, full width, the two
   community goals as bands (`.hero-ladder`): the Dan ladder (how far up), then the completion goal (how far across,
   `goalBand()`). They are the only progress marks on the page.
2. **Throne line:** Tris's #1s, a ruled row.
3. **Portugal's best:** the three top 5s.
4. **Two columns:** what to play on the left (map of the week, "This week so far", then "Still to clear": the three
   easiest uncleared ranked maps and the latest first clear, `goalNext()`); what's happening on the right (recent
   activity).
5. **Since 2018**, then **How to join**.

Completion appears twice and never more: the figure in the hero, and the nudge beside the map of the week. Neither
loads `completion.json` (about 90 KB compressed); both read `meta.json`'s `completion` (`homeGoal()` in
`tools/lib/completion.mjs`). Each part hides on its own when the data doesn't have it yet.

### Cards and objects

- **`.card`** is an open section: a hairline above it and a small sentence-case title (`h2.card-h`).
- **`.card-link`** is one clickable object; on hover its fill and border step up one layer.
- **`.banner`** has real cover art and is the hero of map and challenge pages.

### Badges and tags

Prefer status as words in the line under a name (`.profile-line`): Foundations doesn't box static status.
- **`.badge`** is a status outline: gold for honours, accent for "you", red for problems.
- **`.legend-tag`** is the "legend" or "inactive" tag: faint text in a thin `--border-strong` outline (the user's
  choice; the one boxed status), middle-aligned so it's centred on the name. It must explain itself visibly (see
  Tooltips).
- **`.fun-chip`** is an in-joke as a toggletip, on profiles and maps only, three at most before "+N more".

### Search and fields

- **The search field** (`.search-field`) is at least 150px wide (220px in the bar), with the magnifier on the left and
  a `/` hint.
- Results update as you type: at most 8, the match in the accent, and a "See all" row.
- **On phones** a "Search" button opens a full-width row.
- **`.input` and `.select`** are 36px tall, with an `--input-border` edge that turns accent on focus. The label sits
  above in `--fs-sm`, with no colon. They're at most about 320px wide in a toolbar.
- Placeholders are hints, never labels.

### Tooltips and toggletips

- **`title=""`** may only repeat what is already visible, such as the full date behind "3 days ago" or a truncated
  title. It doesn't show on touch or keyboard.
- **Explanations people need** go in visible text, the glossary, or a toggletip:
  - a row of in-jokes under a name: `funChips()`, with the tip in the line under the row;
  - one tag or word in a line or a table cell ("legend", "inactive", "estimated"): `tipTag()`, a button that opens one
    shared bubble (`.tip-pop`) beside it. The bubble is fixed to the window, so a scrolling table can't clip it, and is
    a live region, so it's read out. Escape, another click, losing focus or scrolling closes it.
  - Inside a link a button can't go, so `tipTag(…, { plain: true })` gives the bare tag; the page it links to explains.
- **Length:** under 200 characters. Complete sentences end with a full stop.

### Notices, toasts and disclosures

- **`.notice`** is a plain dim paragraph.
- **`.toast`** is only for brief confirmation ("Copied"), never for something that needs action.
- **No modal dialogs.** Foundations keeps those for questions the user must answer, and the site has none.
- **`details.history`** holds heavy, secondary content. Its summary is in sentence case with "Show ▸" and "Hide ▾".
  Never hide frequently used controls in one.

---

## 10. Data visualisation

*Sources: Accessibility (colour never alone, colour blindness, alt text), Progress Bar (bars only for known
quantities).*

`core/charts.js` draws the charts; they are styled by `.chart`, `.legend`, `.chart-tip` and `.hbars`.

- **One series** is the accent. Grid lines are `--border`, axis text `--text-faint` at 12px, tracks `--surface-3`.
- **Two sides** (Compare): the accent for the first player and one other colour for the second, always labelled with
  names.
- **Categories** use the `--cat-*` colours, always with a word in the legend.
- **Dashed means estimated** (`.line-dashed`), and the legend says so. Dashes mean nothing else anywhere.
- **Every chart** has an accessible name listing its values, is keyboard-focusable with arrow-key readout
  (`chartHover`), and shows exact numbers in `.chart-tip`.
- **Bars start at zero.** No 3D, no gradient fills, no pies; use `.hbars` for shares.
- **Meters** only for known quantities, such as stages passed out of 19.
- **Star pills** use osu!'s spectrum because it's osu!'s data colour. Controls such as the slider stay single Rosa.

---

## 11. Accessibility

*Sources: Accessibility (contrast, focus, click targets, keyboarding, alt text, link text, checklist).*

| Area | Target |
|---|---|
| Text contrast | 4.5:1 or more, `--text-faint` included, on whatever it sits on |
| Non-text contrast | 3:1 or more for input edges, focus rings, slider tracks and thumbs, chart marks, category squares |
| Focus | Visible on everything interactive, distinct from hover, never clipped |
| Touch targets | **44 × 44px** for primary touch controls (Foundations cites WCAG 2.5.5). **24 × 24px** minimum for everything else (WCAG 2.5.8): extend the hit area with padding where the visible element is smaller |
| Keyboard | Tab, Shift+Tab, Enter, Space, Escape and the arrow keys work everywhere, in visual order, with no traps. `/` opens search |
| Structure | One H1 per page, focused on navigation; headings in order; labelled landmarks; table captions and `th scope` (`enhanceTables()`) |
| Live updates | New result counts and lists go through `announce()` |
| Images | Covers and avatars beside a name are decorative (`alt=""`). Other alt text says what the image is, without "Image of" |
| Motion | `prefers-reduced-motion` everywhere; nothing flashes |

**Before committing UI:**
- Check at 375px and at 1440px.
- Use the page with the keyboard only.
- Turn on reduced motion.
- Check each new colour pair's contrast from its hex values.

---

## 12. Voice and content

*Sources: UI Writing Guide (clear, concise, consistent, action-oriented, user-centric, inclusive), Errors and
Messaging, Label, Tooltip, Accessibility (link text).*

**Voice:** a regular from the Discord explaining the site to a friend. Plain, short, specific and slightly dry. Say
"you".

**Microcopy:**
- **Headings** say what the page is ("Leaderboards"), never a slogan. `pageHead()` takes at most one plain sentence of
  intro.
- **Labels** are nouns of one to three words, with no end punctuation. **Buttons and menu items** are verbs.
- **Explain once**, where it's needed, and link to `#/glossary` instead of repeating the explanation above every table.
- **Use players' own terms:** pp, FC, SS, nomod, HDDT, converts, loved, snipe, Dan. New terms go in the glossary.

**Numbers:**
- Always format through `core/fmt.js` (en-GB): `num` (12,345), `pp` (1,062 / 812.34), `acc` (99.74%), `rank`
  (#1,563), `plural`.
- A missing value is "—".
- Units: `1,062pp` in rows (`ppText()`) and "8,366 pp" in running text; `1,419x`; `3 ✕`.
- Ranks carry `#` and a scope: "#1 PT", "#288 global".

**Dates:**
- Use `fmt.date` (7 Oct 2025), `fmt.ago` (3 days ago) and `fmt.monthYear` (Mar 2019).
- Use relative time for recent activity, with the full date in `title`. Use absolute dates for records and history.
- Weeks are in Europe/Lisbon time.

**In-jokes:**
1. **Only real ones**, from the Discord and its people: badge names, Dan role lore, Tris's throne, Alphonse, "Ainda
   há muita sopa para comer". No invented or generic gamer quips.
2. **At most one per view**, where regulars will find it: the footer quip, the 404, a badge tip, a Records caption.
   Never in loaders, empty states, errors, labels, buttons or headings.
3. **A joke sits beside the information, never instead of it.**
4. **Easter eggs stay opt-in** and respect reduced motion.
5. **Portuguese only as quoted lore** (`lang="pt-PT"`).

**Errors:** problem, cause, fix (§8). Polite and blameless. Never "invalid", "illegal" or a bare "Something went
wrong".

---

## 13. Review checklist

**Do:**
- [ ] Use existing tokens and helpers. A new colour, size or space becomes a token in `:root`.
- [ ] Give each view one hero; everything else steps down in size or colour.
- [ ] Box only objects you can pick up whole; group with space and hairlines.
- [ ] Use sentence case, labels of three words at most, and buttons that start with a verb.
- [ ] Keep the accent to links, actions, current or selected things, "you" and focus; gold to #1, Hebrew Dan and
      honours.
- [ ] Format numbers and dates with `fmt.js`, and right-align number columns.
- [ ] Give every control a visible focus, a keyboard path, and a 24px hit area (44px for primary touch controls).
- [ ] Reserve space while loading, and say "Loading…".
- [ ] Make empty states say what's empty, with at most one action.
- [ ] Write errors as problem, cause, fix.
- [ ] Put a reduced-motion rule next to every animation.
- [ ] Check at 375px and 1440px.

**Don't:**
- [ ] Hex values in components, or `style=""` in page JS.
- [ ] Uppercase or letter-spaced labels, or slogans under an H1.
- [ ] New boxes, card grids or `border-left` stripes to make something stand out.
- [ ] Glows, coloured shadows, gradients, shimmer, pulses, or glass beyond the top bar.
- [ ] Colour as the only signal, or a second job for a colour.
- [ ] Rainbows on controls (osu!'s own data colours aside).
- [ ] Dashed borders as a private code.
- [ ] Pills for values osu! doesn't pill.
- [ ] Arrows after link text.
- [ ] Jokes in loaders, errors, empty states or buttons, or invented jokes.
- [ ] Needed explanations hidden in `title` tooltips.
- [ ] Type under 12px, or between scale steps.

---

## 14. Gaps in today's code

The `design-pass` branch (2026-10-26) applied this guide to the site:
- spacing tokens and classes in place of the static inline styles;
- every size on the scale, and labels in sentence case;
- osu!, grade, podium and Discord colours as tokens, and one job per colour (event squares, Compare, Wrapped, eyebrows,
  code, hero);
- contrast fixes for the slider track and the search field;
- 44px touch targets on touch screens;
- no pulses, shimmers, lifts or accent shadows;
- no side stripes, dashed borders or boxed status (the legend tag aside);
- four breakpoints, and no arrows after links;
- a plain "Loading…", and errors written as problem, cause and fix;
- quips only on the rare real-lore events, and no emoji in the activity feed;
- the "Fewer boxes" and "Quieter labels" overrides folded into their original rules.

Still open. Line numbers drift, so search for the selector.

1. **Some meaning is still only in `title` or `aria-label`.** The quieter `.diff-new` (no Portuguese scores yet) says
   why only in its label, and `posBadge()` puts "Position in Portugal" in `title`. The tags and "estimated" are
   toggletips now (`tipTag()`).
2. **One hex value outside `:root`:** the tile stroke in `ambience.css`. A `data:` URI can't read a variable; it's
   `--cat-c` by value.

Done since: the blocks once appended to `site.css` (search, "you", sign-in, the a11y fixes, goal, peek) sit in their
sections, with a Challenges section and a Utilities section last; rank links on stat tiles have a 45px-tall hit area and
heading links reach 44px on touch; spacing is on the scale everywhere (§4); tabs and top 5 lines read their figures apart from their names; the menu button, the
bacalhau loader and the flash easter egg calm down under reduced motion.

Allowed on purpose: table headers in small capitals, and fluid sizes made with `clamp()` (H1, stat values, Dan
glyphs). Each of those is bounded by scale steps.

---

## Sources

All from https://www.foundations.unity.com/ (Editor Foundations, LTS 2022.3), read on 2026-10-26 and paraphrased.

**Read:**
- **Getting Started.**
- **Fundamentals:** Accessibility, Color Palette, Iconography, Interactions, Typography, UI Writing Guide, UX
  Essentials.
- **Patterns:** Authoring Flows, Content Organization, Contextual Tooling, Empty States, Errors and Messaging,
  Inheritance, Overlays, Project Settings & Preferences, Selection History Navigation, Windowing.
- **Components:** Button, Color Field, Dropdown, Foldout, Help Box, Label, List View, Multi-column Views, Numeric
  Field, Object Field, Progress Bar, Radio Button, Reorderable List, Scroll View, Search Field, Slider, Tab, Text
  Field, Toggle, Toolbar, Tooltip, Tree View.
- **Also:** Resources and Changelog.

**Not available:** the Copy Style Guide (docs-style-guide.unity.com) is Unity-internal (403). Contextual Help, Layouts,
Menus and Breadcrumbs are marked work in progress and have no pages.

| Carried over | Unity-Editor-specific, left out |
|---|---|
| Colour as role-named variables; flat depth from layers and borders; semantic colour; contrast ratios | The light theme, USS/IMGUI values, Editor blue (Rosa does its job here) |
| A small type scale, left alignment, sentence-case buttons | The 12px base and 18–20px control heights |
| Containers and rounded corners mean "interactive"; group with space first | Inspector paddings, foldout indents, override bars, inheritance |
| The state model; hiding versus disabling | Drag-and-drop zones, scrub-on-label, context menus |
| Empty states; problem, cause, fix; choosing the message form by scope | OS dialogs and button order, console logs, window banners |
| Tooltip length and naming; no icons in buttons | The PNG icon pipeline and the icon palette |
| The slider as one linear value with keyboard steps | Overlays, docking, window types, toolbars, Contextual Tooling, Selection History |
| Contrast, 44px targets, keyboarding, no flashing, the right loader | Localisation (the site is English-only) |
