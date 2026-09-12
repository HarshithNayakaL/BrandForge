# BrandForge — Architecture

## The core problem

The naive version of this product is one giant prompt: paste a brand name and a product, ask a
model for six campaign images. It fails in two specific ways, and every design decision here is
aimed at one of them.

**Failure one — the brand is imagined.** A model asked about a brand recalls it from training
data, or invents a plausible aesthetic. That is not the brand; it is a stereotype of the
category. So the brand is *observed*: a Playwright crawler collects real evidence from the
brand's own site, and the analysis model is told to work only from that evidence and to mark
which claims it actually saw versus inferred.

**Failure two — the product drifts.** Generative models produce a *plausible* member of a
category, not *your* item. Across six images the hinge changes, the sole unit changes, the
label text changes. So the product is pinned: analysed once into a canonical identity with
explicit invariants, anchored in every generation via the image-edits endpoint, and then
verified attribute by attribute after the fact.

Everything below follows from those two.

---

## Services

Four local processes, each with one job.

```
┌──────────┐   /api    ┌──────────────────────────────┐  /crawl    ┌────────────────┐
│   web    │──────────▶│            api               │───────────▶│    crawler     │
│  :5173   │           │            :3001             │  /tools/*  │     :3002      │
│  React   │◀──────────│  run state · keys · stages   │◀───────────│   Playwright   │
└──────────┘  polling  └──────────────────────────────┘  evidence  │  + retrieval   │
                             ▲              │                      └────────────────┘
                    webhook  │              │  Gemini · OpenAI              │
                             │              ▼                               ▼
                       ┌───────────┐   (model APIs)              Wikipedia · Wikidata
                       │    n8n    │                             Wayback · sitemaps
                       │   :5678   │                             the brand's own site
                       └───────────┘
```

The crawler has two faces. `/crawl` is the bounded sweep that produces an evidence bundle;
`/tools/*` is the retrieval surface the brand intelligence drives itself. Both enforce the same
SSRF guard, and neither needs an API key.

| Service | Owns | Deliberately does not |
|---|---|---|
| `web` | Intake, live progress, gallery | Hold any credential, or contain pipeline logic |
| `api` | Run state, stage implementations, both API keys, artefact serving | Decide *when* stages run, under n8n orchestration |
| `crawler` | Deterministic web evidence, the retrieval tools, SSRF enforcement | Reason about what it collected |
| `n8n` | Routing, sequencing, fan-out, error branches | Any AI reasoning, or any deterministic work a Code node can do |

### Why the API owns the model calls rather than n8n HTTP nodes

n8n could call Gemini and OpenAI directly. It does not, for three reasons:

1. **Keys stay in one server-side process.** One place to secure, one place to rotate.
2. **LLM output gets schema-validated before it can move downstream.** Every model response is
   parsed by a fence- and prose-tolerant extractor, checked against a zod schema, and retried
   once with the validation errors fed back. Invalid JSON never reaches the next stage. Doing
   that inside n8n expression fields would be fragile and unreviewable.
3. **Generation is idempotent.** Output is addressed by `run_id / shot_id / attempt`. A retry
   checks the filesystem before spending another call, so a re-run never double-bills.

n8n still makes every *decision* — cache hit or crawl, pass or repair, continue or halt. It is
the orchestrator, not a passthrough.

---

## The pipeline

### 1. Validation, before anything expensive

Shape-checking happens at the API (`validate-input.js`), and the authoritative SSRF check
happens at the crawler, which resolves DNS and inspects **every returned address** — a hostname
that resolves to `127.0.0.1` is rejected even though it looks public. Loopback, RFC1918,
link-local (including `169.254.169.254`), CGNAT, multicast, IPv6 loopback/ULA and IPv4-mapped
IPv6 are all blocked, and each redirect hop is re-validated, because a public URL can redirect
inward.

Uploads are typed by magic bytes, never by the client's `Content-Type`. Filenames are generated
server-side; the upload's own name never reaches the filesystem. Run and brand ids are validated
against `^[A-Za-z0-9_.-]{3,80}$` before becoming path segments, and the asset route additionally
resolves the final path and confirms it is still inside the run directory.

### 2. Crawling — bounded and deterministic

No LLM browses the web. Playwright collects; code filters.

- **Bounded**: `MAX_CRAWL_PAGES`, `MAX_PRODUCT_PAGES`, per-page and total timeouts, and a
  concurrency cap. Never a blind full-domain crawl.
- **Prioritised**: the seed page is visited first so its links inform the rest. Links are
  classified by URL shape into home / collection / product / campaign / about, and each role has
  its own quota, so the crawl sees the brand's *range* rather than forty product pages.
- **Filtered**: transactional and legal paths are excluded outright. URLs are normalised —
  tracking params stripped, hash dropped, query sorted, trailing slash collapsed — so variants
  dedupe to one entry.
- **Junk imagery rejected**: icons, sprites, payment marks, social glyphs, tracking pixels,
  placeholders, anything under `MIN_IMAGE_*` or with an extreme aspect ratio. Logos are the one
  deliberate exception to the junk-token rule.
- **Best source picked**: the largest `srcset` candidate wins over the placeholder `src`;
  `og:image` is kept because it is the brand's own chosen hero frame.

Everything is source-attributed, and the crawler validates its own output against
`EvidenceBundleSchema` before returning it. A service that violates its own contract fails loudly
rather than passing malformed evidence downstream.

### 2b. Retrieval as a tool surface (the grounding layer)

The original design ran the crawler once, as stage 06, and handed a fixed bundle downstream. That
is being inverted: the crawler becomes **the model's search engine**, a set of tools it calls in a
loop whenever it decides it does not know enough. Grounding comes from our own retrieval rather
than from model recall or a paid search API.

**Why not general web search.** It was tested, not assumed. Every free engine blocks an automated
client: `html.duckduckgo.com` returns 403, Mojeek serves a CAPTCHA, Startpage and Searx return no
parseable results, all from a real browser with a normal user agent. An architecture resting on
free search would rest on sand. A keyed free-tier engine can be added later as an adapter; nothing
depends on one.

What replaces it is better suited to the question anyway, because the product reasons about one
brand's own output rather than the open web:

| Tool | Source | Answers |
|---|---|---|
| `lookup-brand` | Wikipedia + Wikidata | Is this brand established? Official site, industry, founding |
| `site-map` | `sitemap.xml`, `robots.txt` | The brand's own page inventory, classified by role |
| `fetch-page` | Direct fetch | One page: headings, copy, JSON-LD, og:image, social handles |
| `timeline` | Wayback CDX | How the brand presented itself across years |

All four are free and keyless, and all four go through the same SSRF guard as the crawl.

**Known versus unknown brands.** `lookup-brand` decides this from data rather than from the
model's sense of familiarity, which is where confident hallucination starts. An established brand
has a Wikipedia article and a Wikidata entity; an unknown one has neither.

The rule that follows is the important part: **recall is a search prior, never evidence.** If the
model believes a brand shoots on-model, that belief may direct the agent to the right pages, but
the claim only enters the Brand Kit once a fetched page supports it. This keeps the speed benefit
for known brands without inheriting a year-stale training snapshot.

**Social platforms.** Handles are read from the brand's own footer; feeds are not scraped.
Instagram, TikTok and X are auth-walled and prohibit automated collection, so a scraper aimed at
them would be unreliable as well as out of bounds. The handles alone still say which platforms a
brand invests in, which is a signal about how it posts.

### 3. Brand intelligence — observation separated from inference

The evidence is *compacted* before it reaches the model: deduplicated titles, headings, copy,
navigation terms, JSON-LD facts and a sampled palette. Never a raw site dump.

Ten reference images are chosen as a spread across logo / campaign / product so the model sees
the brand's range. Each claim in `photography_language` carries a `basis` of `OBSERVED` or
`INFERRED` plus the reference ids it rests on, and confidence is recorded per section. The
prompt-builder later ranks observed claims ahead of inferred ones, so evidence-backed direction
wins when the two disagree.

The model is explicitly told to work only from supplied evidence *even if it recognises the
brand* — that is what stops training-data recall from leaking in.

Model-supplied `evidence_refs` are intersected with the references actually sent, because models
cite ids they were never given.

**Caching**: profiles are keyed by domain and invalidated by both TTL and schema version. A
second run against the same brand skips the crawl and the analysis call entirely.

### 4. Product intelligence — analysed in isolation

The product is analysed with **no knowledge of the brand**. This independence is the point: if
the brand kit were in context, brand styling would contaminate the description of what the
product physically is.

The model determines the category itself, then derives the invariants *for that category*. This
is what makes the system category-agnostic — nothing in the code knows what a watch is:

| Category | Invariants it derives |
|---|---|
| Eyewear | frame geometry, hinge, lens shape, lens tint, temple profile |
| Footwear | silhouette, sole unit, panel layout, lacing, colourway |
| Packaged goods | package geometry, label layout, factual text, claims, cap |
| Watch | dial, case geometry, bezel, crown, strap, markers |

Each invariant states the **observed value from this image**, not a generic instruction —
`"Matte olive body with brass collars"`, never `"keep the colour accurate"`. That specificity is
what makes both the generation prompt and the QA check meaningful. Anything ambiguous goes to
`uncertain_features`, which the prompt then tells the generator not to invent.

### 5. Planning — the join point

The planner is the first stage that sees both the brand and the product, and it chooses the six
shots rather than filling a template. A macro detail shot names the invariants visible *at that
distance*; a lifestyle shot names different ones.

Two deterministic corrections are applied after the model returns, because a planner is not
trusted with correctness:

- Invariant keys are intersected with the real ones — the model cannot invent a key that QA
  would then be unable to check.
- Every `CRITICAL` invariant is unioned into every shot, whether the planner listed it or not.

### 6. Generation — the product is the anchor

Every generation goes through the **image edits** endpoint with the uploaded photo as input
image zero. This is the single most important decision for fidelity: a text-only generation
invents a plausible product, an edit is anchored to the real one.

Prompts are **composed from reusable components**, never handwritten per brand or category. The
same code path builds the prompt for a moisturiser on a minimal D2C brand and a boot on a
heritage outdoor brand; only the inputs differ. Every prompt opens with an explicit priority
order:

```
1. The product in the first supplied image must be reproduced exactly.
2. The brand's visual language.
3. This shot's creative direction.
4. Your own aesthetic judgement.

If the shot direction cannot be executed without changing the product,
change the shot, never the product.
```

Brand reference images are passed as style references with an explicit instruction not to let
them alter the product. They are fetched once per run and reused across all six shots, which is
cheap and keeps the six visually coherent.

The exact prompt for every attempt is written next to its image.

### 7. QA — generated output is untrusted

The reviewer sees the original and the generated image side by side, plus the identity, the shot
brief and the brand rules, and checks attribute by attribute.

**The model scores; deterministic code decides.** `applyCriticalOverride` is the actual arbiter:

- Any false critical check or failed invariant forces `REPAIR`, no matter how high the aesthetic
  scores are or what the model concluded. A beautiful image of the wrong product fails.
- Sub-threshold `product_accuracy` forces `REPAIR` on its own.
- Out of repair budget converts `REPAIR` into `BLOCK` — never into a silent pass.

Any invariant the reviewer fails to report on is recorded as a **failure**, not a pass. A silent
omission cannot become an accidental approval.

### 8. Repair — selective and bounded

One shot failing regenerates that shot only. The repair prompt is corrective rather than a fresh
roll: it states that composition and lighting were acceptable and must be preserved, lists the
specific defects with the correct values from the reference, and passes back only the invariants
that actually failed.

Bounded at `MAX_REPAIR_ATTEMPTS`. After that the shot is `BLOCKED`, kept on disk, and shown in
the gallery marked as failed with the reason. Five verified images and one honest block is a more
trustworthy product than six images pretending to have succeeded.

---

## Model facts that constrain the code

These were checked against current provider documentation rather than recalled, because the
integration was originally written from a training snapshot that predates the models in use.

**`gpt-image-2.5-sunburst`** is the image model. `gpt-image-2.5` alone is not a valid id; the 2.5
family ships as `-sunburst` (most capable, generation and editing) and `-flare` (fast everyday).
Sunburst is the default here because every generation is an *edit* anchored to the uploaded
product photo, so editing support is not optional. `v1/images/generations` and `v1/images/edits`
both remain supported and do not have to be routed through the Responses API, so the existing
multipart request shape stands.

**`gemini-3.8-flash`** thinks by default at `medium`. That is billed and adds latency on every
call, and these stages do structured extraction against supplied evidence rather than open
reasoning, so the default here is `low`, set through `GEMINI_THINKING_LEVEL`. **`minimal` is not a
supported level and returns an error**, so the client filters any unrecognised value down to
`low` rather than forwarding it and failing the call.

**For the agent loop still to be built:** 3.8 Flash requires every `FunctionResponse` to carry
both `call_id` and `name` on the `generateContent` API, multimodal assets to sit inside the
response payload, and inline instructions to be separated by line breaks. Getting this wrong is a
silent tool-calling failure rather than a clear error.

## State and observability

Run state is file-backed under `data/runs/{run_id}/`. Deliberately not a database: the PRD's
storage layout is already a natural on-disk tree, every artefact is inspectable by hand, and
there are no native build dependencies to install on Windows.

- Writes are **atomic** (temp file + rename), so a crash mid-write cannot corrupt state.
- Read-modify-write is **serialised per run id**, so six concurrent shot updates cannot clobber
  each other's progress counters.
- Every event is appended to `events.ndjson` with `run_id` and `shot_id`, and the frontend
  renders those directly — the progress display is real state, never a timer.

Generation history is never discarded. A shot repaired twice keeps three images, three prompts
and three QA verdicts.

---

## Failure model

Every failure carries one of the PRD's codes, and it reaches both the run state and the UI.

| Stage | Codes |
|---|---|
| Intake | `INVALID_URL`, `INVALID_PRODUCT_IMAGE` |
| Crawl | `CRAWL_FAILED`, `CRAWL_TIMEOUT`, `INSUFFICIENT_BRAND_EVIDENCE` |
| Intelligence | `BRAND_ANALYSIS_FAILED`, `PRODUCT_ANALYSIS_FAILED`, `CAMPAIGN_PLANNING_FAILED` |
| Generation | `GENERATION_FAILED`, `GENERATION_TIMEOUT`, `RATE_LIMITED` |
| QA | `QA_FAILED`, `REPAIR_FAILED`, `MAX_REPAIR_ATTEMPTS` |
| Run | `PARTIAL_CAMPAIGN_FAILURE`, `SYSTEM_ERROR` |

Every retry is bounded — model calls, image generations, repairs, crawl pages, redirect hops.
There is no unbounded loop anywhere in the pipeline. A QA failure never ships the image; it
blocks it.

---

## Cost control

Generation is the expensive stage, so nothing is generated until the input validated, the brand
kit exists, the product identity exists and the plan exists. Brand profiles are cached per
domain. Only failed shots regenerate. Attempts are counted and reported in the manifest. And
because output is addressed by attempt, a retry checks disk before spending.

---

## What is deliberately not here

Per PRD §55: no accounts, billing, teams, permissions, analytics, manual editing, social
publishing or commerce integrations. The intelligence pipeline is the product.
