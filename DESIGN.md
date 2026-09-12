# DESIGN.md — BrandForge

## Theme

A dark app shell above a near-white working canvas.

The chrome is dark so the product has an identity the moment it loads; the canvas stays at effectively zero chroma so nothing biases how the user perceives colour in the photography they are judging. The single hue in the system (indigo, 270°) appears in actions, live state and the mark; the neutrals carry a trace of it (chroma 0.002–0.016) so greys read as intentional rather than default.

Explicitly not cream, sand, paper or parchment. Explicitly not dark terminal chic, and not a dark-sidebar SaaS clone: the dark band is a slim top bar, and the identity is carried by the production language below it.

## Signature: production language

The subject of this product is photography and verification, so the interface borrows from how photographic work is actually marked up, not from dashboard convention.

- **Crop marks.** Thin corner brackets sitting *outside* the hero frame, the way a contact sheet or print proof is marked. One device, used once per screen, never decoratively.
- **Frame numbers.** `SHOT_01`–`SHOT_06` in mono, on every frame and slot, the way a contact sheet is indexed.
- **Contact-sheet rhythm.** The gallery is a hero frame spanning two rows plus five supporting frames, not six identical cards. Frames use a 3px radius so they read as photographs, not as UI cards.
- **The mark** is an aperture inside a frame with its corners cut away, echoing the crop marks at 22px.

## Color

All values OKLCH. Contrast verified by `scripts/check-contrast.mjs` (20/20 pass, AA), including every pair used on the dark shell.

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
| `--shell` | `0.205 0.016 270` | | App bar ground |
| `--shell-2` | `0.285 0.016 270` | | App bar hover and active |
| `--on-shell` | `0.970 0.003 270` | | App bar text, 16.43:1 |
| `--on-shell-2` | `0.740 0.014 270` | | App bar muted text, 7.77:1 |
| `--accent-lift` | `0.720 0.150 270` | | The mark and focus rings on dark, 7.03:1 |

Strategy: **Restrained.** Accent covers well under 10% of any screen. Semantic colours appear only on status, never as decoration.

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
