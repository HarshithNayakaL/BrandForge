# BrandForge

Give it a brand's website and one product photo. It researches the brand from that site,
works out what cannot change about your product, plans its own campaign, generates six
brand-aligned images, checks its own work, repairs what it can and refuses what it cannot
safely fix.

Then give it a completely different brand without editing anything.

```
brand URL + product image
   ↓
validate            SSRF guard, magic-byte image check
   ↓
Playwright crawl    bounded, filtered, deterministic
   ↓
brand intelligence  Gemini, multimodal  →  Brand Kit          ← cached per domain
   ↓
product intelligence Gemini, product image only  →  Canonical Product Identity + invariants
   ↓
campaign planner    →  six Shot Contracts
   ↓
generation          OpenAI image edits, your photo as the anchor, 3 at a time
   ↓
multimodal QA       original vs generated, attribute by attribute
   ↓
PASS → final     REPAIR → that shot only     BLOCK → shipped as blocked, never hidden
   ↓
manifest.json + gallery
```

---

## Quick start

```bash
npm run setup
```

Copy `.env.example` to `.env` and add two keys:

```
GEMINI_API_KEY=...
OPENAI_API_KEY=...
```

Start everything:

```bash
npm run dev
```

| Service | URL | Holds keys |
|---|---|---|
| Web | http://localhost:5173 | no |
| API | http://localhost:3001 | **yes, both** |
| Crawler | http://localhost:3002 | no |

Check the wiring before your first run:

```bash
npm run preflight
```

It reports which keys the API can actually see, so a missing key shows up before you spend anything.

---

## Try it without API keys

Every screen can be reviewed with no keys and no network:

```bash
npm run fixtures
```

This seeds three local runs (completed, partial with a blocked shot, failed). Their imagery is
composed locally with Playwright from a product photo already on disk. It is **not** model
output and never pretends to be: run ids are prefixed `run_fixture_`, the manifest carries
`"fixture": true`, and the model fields read `fixture (composed locally)`.

Clear them before your first real run:

```bash
npm run fixtures:clean
```

---

## Verify everything

```bash
npm run verify
```

One command, no keys, no external network. Eight groups:

| Group | What it proves |
|---|---|
| Palette contrast | 15 text/background pairs at WCAG AA |
| Unit tests | 52 tests over the deterministic parts |
| Production build | the frontend actually builds |
| n8n workflow build | the importable JSON regenerates |
| n8n workflow integrity | connections resolve, every node reachable, Code nodes parse, every money-spending HTTP node has an error path |
| SSRF blocklist | 16 vectors rejected |
| API security and error paths | traversal, auth, malformed ids, upload validation |
| UI sweep | 3 viewports: console errors, failed requests, horizontal overflow, text overflow, broken images, target sizes, accessible names, keyboard focus |

Individual pieces: `npm run check:ui`, `check:contrast`, `check:workflow`, `npm test`.

---

## Running it through n8n

The pipeline runs in-process by default. To hand orchestration to n8n:

```bash
npm run n8n
```

1. Import `n8n/workflows/brandforge.json` (Workflows → Import from File).
2. Open **Init Run Context** and set `internal_token` to match `INTERNAL_TOKEN` in `.env`.
3. Activate the workflow.
4. Restart the API with the orchestrator switched over:

```bash
ORCHESTRATOR=n8n npm run start:api
```

The API then posts each new `run_id` to the n8n webhook and n8n calls the stage endpoints back.
Both paths execute the same stage functions; there is one implementation, not two.

Node types and typeVersions in the exported workflow were read from the installed n8n
(webhook 2.1, httpRequest 4.4, code 2, if 2.3, respondToWebhook 1.5, noOp 1) and are
re-checked by `npm run check:workflow`.

---

## What you get back

**Campaign tab** — the six images, each with its purpose, QA accuracy score, repair count and
shot brief. Click any image to compare it side by side against your original photo, which is
the judgement this tool actually asks you to make. Blocked shots keep full layout weight and
carry the reason they failed.

**Brand evidence tab** — what the crawler took off the site: every reference image with its
type, confidence and source page; every page read with its detected role; the text and colours
sampled; and every brand conclusion tagged `observed` (backed by specific evidence) or
`inferred` (the model generalising).

---

## Configuration

Everything lives in `.env`; nothing is hardcoded.

| Variable | Default | Effect |
|---|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash` | Brand, product, planning and QA reasoning |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | Image generation |
| `MAX_CRAWL_PAGES` | `12` | Hard ceiling on pages visited |
| `MAX_REFERENCE_IMAGES` | `24` | Ceiling on kept reference images |
| `GENERATION_CONCURRENCY` | `3` | Parallel image generations |
| `MAX_REPAIR_ATTEMPTS` | `2` | Repairs per shot before it is BLOCKED |
| `QA_MIN_PRODUCT_ACCURACY` | `7` | Below this a shot is repaired however good it looks |
| `BRAND_PROFILE_TTL_HOURS` | `168` | How long a cached brand profile stays fresh |

Keys live only in the API process. The browser never sees them: Vite proxies `/api`, and the
frontend has no model credentials of any kind.

---

## Output layout

```
data/
  brands/{brand_id}/brand-kit.json        cached profile, reused across runs
  runs/{run_id}/
    input/product.png
    crawl/evidence.json
    crawl/references/                     the curated reference set, saved locally
    intelligence/brand-kit.json
    intelligence/product-identity.json
    campaign/shot-plan.json
    campaign/shot-results.json
    generations/shot_01/attempt_01.png
                       attempt_01.prompt.txt   the exact prompt that produced it
    qa/shot_01_attempt_1.json
    final/shot_01.png                     accepted images only
    manifest.json
    events.ndjson                         the full event log for this run
```

Nothing is discarded: a repaired shot keeps every earlier attempt, prompt and QA verdict.

`data/` is gitignored. It holds uploads and imagery crawled from third-party sites.

---

## Design notes

Two failure modes drove the whole architecture, and both are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):

- **The brand gets imagined.** A model asked about a brand recalls a stereotype of the
  category. So the brand is *observed* from its own site, and every claim records whether it
  was seen or inferred.
- **The product drifts.** Generative models produce a plausible member of a category, not
  *your* item. So the product is pinned: analysed once into invariants, anchored via the image
  **edits** endpoint rather than text-to-image, then verified attribute by attribute.

QA is the part worth reading: the model scores, but deterministic code decides. Any failed
invariant forces a repair no matter how high the aesthetic scores, an unreported invariant
counts as a failure rather than a pass, and running out of repair budget produces a BLOCK,
never a silent pass.

[PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) cover the interface: register, colour
tokens with verified contrast ratios, type scale and component states.

---

## Troubleshooting

**`GEMINI_API_KEY is not configured`** — the run crawls, then fails loudly. Add the key and
restart the API.

**`INSUFFICIENT_BRAND_EVIDENCE`** — the crawler could not get enough off the site (bot
protection, or a near-empty splash page). Point it at the brand's shop or collection URL.

**Almost no reference images** — some sites lazy-load behind interaction. Raise
`PAGE_TIMEOUT_MS`, or lower `MIN_IMAGE_WIDTH` / `MIN_IMAGE_HEIGHT` if the site serves small assets.

**A shot comes back BLOCKED** — that is the system working. Open its details to see which
invariant failed and what QA saw. The rejected image is still on disk under `generations/`.

---

## Status

The pipeline up to brand analysis has been exercised against real sites. Everything past it
(brand kit, product identity, planning, generation, QA, repair) is implemented and
schema-validated but needs live API keys to run end to end.
