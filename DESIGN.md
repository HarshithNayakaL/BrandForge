# DESIGN.md — BrandForge

## Theme

**Swiss Industrial Print.** Matte unbleached documentation stock, carbon ink, one hazard red.

One archetype, committed to: no dark-substrate telemetry styling is mixed in. No gradients, no
soft shadows, no translucency, and `border-radius: 0` enforced globally. Depth is expressed by
rules and compartments, not by elevation.

The substrate is chroma-free, which means photographic colour judgement is *better* here than it
was on the previous tinted canvas. Image frames still hold their own neutral mat (`--mat`).

## Density

The brief was that the interface looked empty. It is answered with content, not with spacing:

- **Telemetry band** under the header carrying real values: system state, workflow revision,
  orchestrator, model link status, current run id, UTC clock.
- **Specification sheet** and **recent runs** fill the intake's second column, which previously
  ran out of content halfway down. The recent list is real data and doubles as the fastest way
  back into a run.
- **Blueprint grid**: `display: grid; gap: 2px` over a contrasting ground draws exact hairline
  compartments. Where a grid's final row can be short, the rules move onto the children as
  `box-shadow: 0 0 0 1px`, because an empty track would otherwise show the ground through.
- **Bimodal density**: micro-typography clusters at 11px against macro numerals up to 9rem.

## Color

All OKLCH, verified by `scripts/check-contrast.mjs` (12/12 AA).

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#f4f4f0` | Unbleached stock, the primary substrate |
| `--paper-2` | `#eae8e3` | Second substrate: inputs, table heads, spec keys |
| `--mat` | neutral | Inside image frames only |
| `--ink` | carbon | Text, and every rule and border |
| `--red` | hazard | The only accent. Alerts, active state, section brackets, blocked |
| `--red-hot` | | The same red, on carbon only, where the darker red would fail contrast |

Hazard blocks always carry paper-coloured text; ink on red does not reach AA and is never used.

## Typography

Three roles. **Archivo Black** for macro structure, uppercase, letter-spacing to `-0.045em`,
line-height to `0.86`, fluid via `clamp()` up to 9rem. **Archivo** for the few passages of real
prose. **JetBrains Mono** at 11px with `0.06em`–`0.14em` tracking for every label, metadata,
navigation item, frame number and readout.

Uppercase is used for structure, labels, navigation and metadata. It is deliberately *not* used
for body copy: the lede, shot purposes and evidence text stay sentence case, because uppercase
paragraphs are unreadable at body sizes. Body copy also holds the 16px floor on phones while
metadata stays at the micro scale, which is what keeps the density legible.

## Symbology

ASCII framing on section labels (`[ REFERENCE IMAGES ]`), `>>` and `//` as disclosure markers,
`>>>` and `///` on the event log, registration crosshairs at frame corners, a grease-pencil ring
around the frame number of the select, and a halftone dot screen over blocked frames rather than
a simple fade.

## Components

Every interactive has default / hover / focus-visible / active / disabled, and loading where it applies.

- **Field**: mono label above, 2px ink boundary, second-substrate fill that clears to paper on
  focus, 3px hazard-red focus ring. 16px text, which is the iOS zoom floor.
- **Button**: 46px, 2px ink border, mono uppercase. Primary is hazard red; hover inverts to carbon.
  48px under `pointer: coarse`.
- **Dropzone**: dashed ink boundary that goes solid once filled, with registration crosshairs
  around the chosen product.
- **Stage row**: pending / active / done / failed. Active is a full hazard-red band, failed a
  carbon band, so state never rests on colour alone.
- **Shot tile**: compartment in the gallery grid. Blocked frames get a halftone dot screen plus
  desaturation, and keep full layout weight.
- **Lightbox**: native `<dialog>`, generated image beside the original product photo for fidelity comparison.
- **Empty states** teach the pipeline rather than saying "nothing here".
- **Waiting screen**: the longest-lived screen in the product. Slots fill with the real frame as each shot clears QA, carrying its accuracy score, so the wait shows work arriving rather than a progress bar.
- **Hero frame**: the first shot that actually passed. A blocked frame never gets top billing, however good it looks.

## Motion

120–200ms. Motion conveys state only, and it is mechanical rather than smooth: the spinner steps
in eight increments instead of sweeping, and the pending slot crawls a diagonal hatch rather than
shimmering. The select ring draws itself once. No page-load choreography, no scroll reveals.
Every animation has a `prefers-reduced-motion: reduce` path; the ring renders already drawn.
