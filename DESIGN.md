# DESIGN.md — BrandForge

## Theme

**Press proof.** Lilac paper, hot magenta, lime, cyan and yellow, on a deep aubergine shell.

The brief was colourful, playful, not corporate. The lazy route there is Y2K gradients and bubble
type, which is exactly the AI-generated look Gen Z audiences report detecting and distrusting, and
which the anti-slop list bans. So the colour is taken from the subject instead: this product is
photo and print production, and a press proof is already loud. Registration crosshairs, a colour
control bar, grease-pencil rings on selects, stickers. Nothing here is a generic "fun" motif.

**The one guardrail:** everything is loud except *inside* the frames, which keep a neutral mat
(`--mat`). A saturated surround changes how a viewer perceives colour in the photograph, and
judging photographic colour is this screen's entire job. Real contact sheets do the same thing:
loud sheet, neutral border around each frame.

## Signature: production marks

- **Registration crosshairs** in cyan and magenta, outside the hero frame, on opposing corners.
- **The control bar** in the run header uses the shape of a press colour bar but carries the
  brand's *actual detected palette*, so it is data rather than ornament. It replaced a duplicate
  swatch row, not added to it.
- **A grease-pencil ring** around the frame number of the select, drawn on with a stroke animation.
  Around the *number*, never across the picture: an editor circles the frame number on a contact
  sheet, and the photograph has to stay readable.
- **Stickers** for status, rotated 2.5 degrees with a hard offset shadow, as if applied by hand.
- **Hard offset shadows** (`3px 3px 0`, no blur) on every raised surface, so depth reads as printed
  layers rather than soft elevation.
- **Frame numbers** `SHOT_01`–`SHOT_06` in mono, the way a contact sheet is indexed.

## Color

All values OKLCH. Contrast verified by `scripts/check-contrast.mjs` (23/23 pass, AA).

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#f8f2ff` | Lilac paper. Not white, not cream |
| `--surface` | `#fefcff` | Raised panels |
| `--mat` | `#f4f3f5` | **Inside image frames only.** Neutral, so photo colour stays judgeable |
| `--ink` | `#1a1223` | Aubergine. Text, and every 2px border |
| `--magenta` | `#d3008b` | Primary action, active tab, active stage, select ring |
| `--lime` | `#68d54e` | Accepted, the mark, active nav |
| `--cyan` | `#008ec8` | Registration marks, evidence rules |
| `--yellow` | `#f4ce23` | Direction band, lightbox header, highlight |
| `--red` | `#d81327` | Blocked |

Strategy: **full palette.** Four named colours, each with one job. Colour is never decorative on a
status: every state also carries a text label, so nothing is conveyed by colour alone.

## Typography

Three faces, at the cap. **Bricolage Grotesque** for display (deliberately irregular, variable
optical sizing, and specifically not the Helvetica/Inter uniformity that reads as corporate),
**Inter** for interface text, **IBM Plex Mono** for frame numbers, run ids and scores.

Display roles are fluid via `clamp()`; body and data stay on a fixed scale, because dense tables
read worse when type scales with the viewport.

## Typography

Two faces: **Inter** for everything in the interface, and **IBM Plex Mono** for run ids, frame numbers, timestamps and scores. The mono is not a developer affectation here; it is how frames and takes are labelled in production, and it keeps digits aligned in the score columns. No display face anywhere: a serif in a UI label was the first design's core mistake.

Fixed rem scale, ratio ≈1.2. Not fluid: users view at consistent DPI and a clamped heading that shrinks inside a panel looks worse, not better.

| Step | Size | Weight | Use |
|---|---|---|---|
| `--t-hero` | 42px | 600 | The intake headline, the one place the product speaks first |
| `--t-display` | 32px | 600 | Page title (one per screen) |
| `--t-h2` | 20px | 600 | Section heading |
| `--t-h3` | 15px | 600 | Panel heading, shot title |
| `--t-body` | 14px | 400 | Body, form values |
| `--t-sm` | 13px | 400 | Secondary text |
| `--t-xs` | 12px | 500 | Labels, chips, table headers |

Labels use sentence case at 12px/500 with modest tracking, not the wide-tracked all-caps eyebrow.

## Layout

- App shell: sticky 60px dark top bar, content in a 1280px container with 24px gutters.
- Grid for 2D (gallery, shot slots), flex for 1D (toolbars, meta rows).
- Gallery: a fixed 3-column grid so the hero can span 2×2; it collapses to 2 columns under 1080px and 1 under 700px. The waiting grid and the evidence grid stay `auto-fill` since neither has a hero.
- Radius scale: 6px (controls), 10px (panels), 3px (image frames, so they read as photographs).
- Elevation is restrained: 1px `--line` plus a single soft shadow token. No glass, no gradients.

## Components

Every interactive has default / hover / focus-visible / active / disabled, and loading where it applies.

- **Field**: label above, 1px `--line-strong` boundary, 2px accent focus ring offset from the control.
- **Button**: primary (accent fill), secondary (surface + border), ghost (text). Same height (36px) and radius everywhere.
- **Dropzone**: dashed boundary, hover and drag-over states, large preview once filled.
- **Stage row**: pending / active / done / failed, each with its own mark and colour; active carries the only animation on screen.
- **Shot tile**: skeleton → image, with a status chip and score. Blocked tiles desaturate the image and keep full layout weight.
- **Lightbox**: native `<dialog>`, generated image beside the original product photo for fidelity comparison.
- **Empty states** teach the pipeline rather than saying "nothing here".
- **Waiting screen**: the longest-lived screen in the product. Slots fill with the real frame as each shot clears QA, carrying its accuracy score, so the wait shows work arriving rather than a progress bar.
- **Hero frame**: the first shot that actually passed. A blocked frame never gets top billing, however good it looks.

## Motion

150–220ms, `cubic-bezier(0.22, 1, 0.36, 1)`. Motion conveys state only: stage transitions, skeleton shimmer, tile entrance, dialog open. No page-load choreography. Every animation has a `prefers-reduced-motion: reduce` alternative that crossfades or disables.
