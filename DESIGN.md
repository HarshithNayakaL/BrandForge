# DESIGN.md — BrandForge

## Theme

Light, neutral, product-register. A near-white shell at effectively zero chroma so nothing on screen biases how the user perceives colour in the photography they are judging. The single hue in the system (indigo, 270°) appears only in actions and live state; the neutrals carry a trace of it (chroma 0.002–0.014) so greys read as intentional rather than default.

Explicitly not cream, sand, paper or parchment. Explicitly not dark terminal chic.

## Color

All values OKLCH. Contrast verified by `scripts/check-contrast.mjs` (15/15 pass, AA).

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| `--bg` | `0.985 0.002 270` | `#f9fafb` | App background |
| `--surface` | `1 0 0` | `#ffffff` | Raised panels, inputs, gallery cards |
| `--sunken` | `0.966 0.004 270` | `#f3f4f6` | Wells, image mattes, toolbars |
| `--line` | `0.905 0.006 270` | `#dedfe4` | Decorative separators (1px) |
| `--line-strong` | `0.640 0.014 270` | `#898c95` | Interactive boundaries, 3.22:1 |
| `--ink` | `0.235 0.014 270` | `#1b1e25` | Primary text, 15.98:1 |
| `--ink-2` | `0.452 0.012 270` | `#53565d` | Secondary text, 7.07:1 |
| `--ink-3` | `0.535 0.011 270` | `#6b6d74` | Labels and meta, 4.95:1 |
| `--accent` | `0.480 0.160 270` | `#3c52b6` | Primary action, current state, 6.52:1 |
| `--accent-weak` | `0.955 0.020 270` | `#ebf0fe` | Chip and active-row fills |
| `--ok` | `0.500 0.110 155` | `#1e7546` | Accepted |
| `--warn` | `0.520 0.110 70` | `#915c08` | Partial |
| `--danger` | `0.520 0.170 25` | `#b63132` | Blocked, failed |

Strategy: **Restrained.** Accent covers well under 10% of any screen. Semantic colours appear only on status, never as decoration.

## Typography

One family: **Inter** (variable), with a system fallback stack. Mono (`ui-monospace`) for run ids, timestamps and scores only. No display face anywhere: this is a tool, and a serif in a UI label was the previous design's core mistake.

Fixed rem scale, ratio ≈1.2. Not fluid: users view at consistent DPI and a clamped heading that shrinks inside a panel looks worse, not better.

| Step | Size | Weight | Use |
|---|---|---|---|
| `--t-display` | 30px | 600 | Page title (one per screen) |
| `--t-h2` | 20px | 600 | Section heading |
| `--t-h3` | 15px | 600 | Panel heading, shot title |
| `--t-body` | 14px | 400 | Body, form values |
| `--t-sm` | 13px | 400 | Secondary text |
| `--t-xs` | 12px | 500 | Labels, chips, table headers |

Labels use sentence case at 12px/500 with modest tracking, not the wide-tracked all-caps eyebrow.

## Layout

- App shell: sticky 56px top bar, content in a 1240px container with 24–32px gutters.
- Grid for 2D (gallery, shot slots), flex for 1D (toolbars, meta rows).
- Gallery: `repeat(auto-fill, minmax(300px, 1fr))`, so it reflows without breakpoints.
- Radius scale: 6px (controls), 10px (panels), 14px (image frames).
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

## Motion

150–220ms, `cubic-bezier(0.22, 1, 0.36, 1)`. Motion conveys state only: stage transitions, skeleton shimmer, tile entrance, dialog open. No page-load choreography. Every animation has a `prefers-reduced-motion: reduce` alternative that crossfades or disables.
