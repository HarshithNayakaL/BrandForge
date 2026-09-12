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
generation          gpt-image-2.5 edits, your photo as the anchor, 3 at a time
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

This seeds four local runs (completed, partial with a blocked shot, one frozen mid-generation
so the waiting screen is reviewable, and failed). Their imagery is
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

One command, no keys, no external network. Nine groups:

| Group | What it proves |
|---|---|
| Palette contrast | 20 text/background pairs at WCAG AA, including the dark app bar |
| Unit tests | 61 tests over the deterministic parts |
| Production build | the frontend actually builds |
| Config matches its docs | README, `config.js` and `.env.example` agree on every default |
| n8n workflow build | the importable JSON regenerates |
| n8n workflow integrity | connections resolve, every node reachable, Code nodes parse, every money-spending HTTP node has an error path |
| SSRF blocklist | 19 vectors rejected, across the crawl and the tool endpoints |
| API security and error paths | traversal, auth, malformed ids, upload validation |
| UI sweep | 3 viewports: console errors, failed requests, horizontal overflow, text overflow, broken images, target sizes, accessible names, keyboard focus |

Individual pieces: `npm run check:ui`, `check:contrast`, `check:workflow`, `check:config`, `npm test`.

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

## The retrieval layer

The crawler is not only a pipeline stage. It also exposes the tools the brand
intelligence uses as its grounding, so the model asks our retrieval instead of
reaching for training-data recall or a paid search API.

| Endpoint | Source | Answers |
|---|---|---|
| `POST /tools/lookup-brand` | Wikipedia + Wikidata | Is this brand established? Official site, industry, founding date |
| `POST /tools/site-map` | `sitemap.xml`, `robots.txt` | The brand's own page inventory, classified by role |
| `POST /tools/fetch-page` | Direct fetch | One page: headings, copy, JSON-LD, `og:image`, social handles |
| `POST /tools/timeline` | Wayback CDX | How the brand presented itself across years |

All four are free, need no API key, and go through the same SSRF guard as the
crawl. Try them with the services running:

```bash
curl -s -X POST http://localhost:3002/tools/lookup-brand   -H 'content-type: application/json' -d '{"name":"Allbirds"}'
```

`timeline` is what answers "how did they used to post, and how do they post
now". Fetching an Allbirds snapshot from 2018 returns the title *The world's
most comfortable shoes*; the live site says *Comfortable, Sustainable Shoes &
Apparel*. The positioning shift is visible without a paid data source.

---

## How the system decides what it knows

A model asked about a brand will answer confidently whether or not it has ever
seen that brand. That is the single largest source of invented brand facts, so
the decision is taken from data rather than from the model's own sense of
familiarity.

`lookup-brand` settles it: an established brand has a Wikipedia article **and**
a Wikidata entity, an unknown one has neither. Allbirds resolves to `Q30591057`
with its official URL attached; an invented brand comes back `established:
false`.

The rule that follows is the one to preserve:

> **Recall is a search prior, never evidence.**

If the model believes a brand shoots on-model, that belief may send the crawler
to the right pages. The claim only enters the Brand Kit once a fetched page
supports it. Known brands get the speed benefit of the model knowing where to
look, without the Brand Kit inheriting a training snapshot that is a year
stale. Unknown brands simply have no prior, so everything is discovered by
fetching.

Social feeds are not scraped. Instagram, TikTok and X are auth-walled and
prohibit automated collection, so a scraper aimed at them would be unreliable
as well as out of bounds. Handles are read from the brand's own footer instead,
and which platforms a brand invests in is itself a signal about how it posts.

---

## Configuration

Everything lives in `.env`; nothing is hardcoded.

| Variable | Default | Effect |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.8-flash` | Brand, product, planning and QA reasoning |
| `GEMINI_VISION_MODEL` | falls back to `GEMINI_MODEL` | Product analysis and QA, which are multimodal |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5` | Image generation |
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
