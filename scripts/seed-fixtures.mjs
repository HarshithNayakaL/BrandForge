/**
 * Seeds local fixture runs so every UI state can be rendered and reviewed
 * with NO API keys and NO network access.
 *
 *   node scripts/seed-fixtures.mjs          seed
 *   node scripts/seed-fixtures.mjs --clean  remove them again
 *
 * The six "campaign" images are composed locally with Playwright from a
 * product photo already on disk. They are stand-ins for layout review only,
 * never model output. Every fixture run id starts with `run_fixture_` and the
 * manifest carries `fixture: true`, so they can never be mistaken for a
 * real campaign.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { ManifestSchema } from '../packages/contracts/src/manifest.js';
import { EvidenceBundleSchema } from '../packages/contracts/src/evidence.js';

const DATA = path.resolve('data');
const RUNS = path.join(DATA, 'runs');
const PREFIX = 'run_fixture_';

// ------------------------------------------------------------------- clean

if (process.argv.includes('--clean')) {
  const ids = fs.existsSync(RUNS) ? fs.readdirSync(RUNS).filter((d) => d.startsWith(PREFIX)) : [];
  for (const id of ids) fs.rmSync(path.join(RUNS, id), { recursive: true, force: true });
  const idxFile = path.join(RUNS, 'index.json');
  if (fs.existsSync(idxFile)) {
    const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')).filter((e) => !e.run_id.startsWith(PREFIX));
    fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2));
  }
  console.log(`removed ${ids.length} fixture run(s)`);
  process.exit(0);
}

// ------------------------------------------------------- source product photo

function findProductPhoto() {
  const dirs = fs.existsSync(RUNS) ? fs.readdirSync(RUNS) : [];
  for (const d of dirs) {
    const inputDir = path.join(RUNS, d, 'input');
    if (!fs.existsSync(inputDir)) continue;
    const f = fs.readdirSync(inputDir).find((n) => n.startsWith('product.'));
    if (f) return path.join(inputDir, f);
  }
  return null;
}

const source = findProductPhoto();
if (!source) {
  console.error('No local product photo found under data/runs/*/input/. Run a campaign first, or drop one there.');
  process.exit(1);
}
const productB64 = fs.readFileSync(source).toString('base64');
const productUri = `data:image/png;base64,${productB64}`;

// --------------------------------------------------- local image composition

/** Six visually distinct framings, composed in the browser from one photo. */
const SCENES = [
  { id: 'SHOT_01', bg: '#e9e6e0', scale: 0.68, top: '50%', shadow: true, label: 'hero' },
  { id: 'SHOT_02', bg: 'linear-gradient(160deg,#dcd8d2,#c9c4bc)', scale: 0.6, top: '52%', rotate: -8, shadow: true },
  { id: 'SHOT_03', bg: '#2f2c29', scale: 1.55, top: '46%', crop: true },
  { id: 'SHOT_04', bg: 'linear-gradient(180deg,#f2efe9,#e2ded6)', scale: 0.5, top: '55%', shadow: true },
  { id: 'SHOT_05', bg: '#b9b0a4', scale: 0.78, top: '48%', rotate: 4, shadow: true },
  { id: 'SHOT_06', bg: 'linear-gradient(200deg,#1d1b19,#3a3632)', scale: 0.62, top: '50%', shadow: true },
];

function sceneHtml(s) {
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%}
  .stage{position:relative;width:1024px;height:1024px;background:${s.bg};overflow:hidden}
  img{position:absolute;left:50%;top:${s.top};transform:translate(-50%,-50%) scale(${s.scale}) rotate(${s.rotate ?? 0}deg);
      width:1024px;height:1024px;object-fit:contain;
      ${s.shadow ? 'filter:drop-shadow(0 40px 45px rgba(0,0,0,.28));' : ''}}
  .grain{position:absolute;inset:0;opacity:.05;
    background-image:radial-gradient(circle at 30% 20%,#fff,transparent 60%),radial-gradient(circle at 70% 80%,#000,transparent 55%)}
</style>
<div class="stage"><img src="${productUri}"><div class="grain"></div></div>`;
}

// --------------------------------------------------- fictional crawl evidence

/** Tints that make the fixture reference thumbnails visually distinct. */
const REF_SCENES = [
  { bg: '#efece6', scale: 0.72, rotate: 0 },
  { bg: '#2a2725', scale: 0.66, rotate: -6 },
  { bg: '#cfc8bd', scale: 0.58, rotate: 5 },
  { bg: '#f6f4ef', scale: 1.35, rotate: 0 },
  { bg: '#8f8578', scale: 0.7, rotate: -3 },
  { bg: '#e3ded5', scale: 0.5, rotate: 8 },
  { bg: '#1f1d1b', scale: 0.8, rotate: 0 },
  { bg: '#ddd6ca', scale: 0.62, rotate: -10 },
  { bg: '#f9f7f3', scale: 0.9, rotate: 2 },
  { bg: '#565049', scale: 0.55, rotate: 0 },
];

const EV_PAGES = [
  ['/', 'home', 'Fixture Brand, considered footwear'],
  ['/collections/new-arrivals', 'collection', 'New arrivals'],
  ['/collections/everyday', 'collection', 'Everyday styles'],
  ['/products/knit-slip-on-oat', 'product', 'Knit slip-on, oat'],
  ['/products/knit-slip-on-charcoal', 'product', 'Knit slip-on, charcoal'],
  ['/products/canvas-low-sand', 'product', 'Canvas low, sand'],
  ['/lookbook/late-summer', 'campaign', 'Late summer lookbook'],
  ['/pages/our-story', 'about', 'Our story'],
  ['/pages/materials', 'about', 'Materials and provenance'],
];

const EV_TEXT = [
  ['title', 'Fixture Brand, considered footwear'],
  ['meta_description', 'Knitwear-led footwear made from traceable materials, designed for everyday wear rather than performance.'],
  ['heading', 'Made from what we can trace'],
  ['heading', 'Everyday, not performance'],
  ['heading', 'Late summer lookbook'],
  ['heading', 'A quieter kind of comfort'],
  ['heading', 'Materials and provenance'],
  ['copy', 'Every upper is knitted in a single piece, which removes the seams that usually wear first and cuts offcut waste to close to nothing.'],
  ['copy', 'We photograph our shoes the way they arrive: on a plain ground, lit from one side, with nothing added.'],
  ['copy', 'The midsole is a single density of foam. No air units, no plates, no marketing names.'],
  ['product_description', 'A low-profile slip-on with a fine ribbed knit upper in warm oat, a slim cream midsole and a flat tread. Unlined, with a short knit pull tab at the heel.'],
  ['product_description', 'The same silhouette in charcoal, knitted from the same yarn and finished with a tonal midsole.'],
  ['category', 'Footwear'],
  ['category', 'Slip-ons'],
  ['category', 'brand:Fixture Brand'],
  ['nav', 'New arrivals'],
  ['nav', 'Everyday'],
  ['nav', 'Materials'],
  ['nav', 'Our story'],
  ['nav', 'Lookbook'],
];

const REF_META = [
  ['product', 'Knit slip-on in oat, three-quarter view', '/products/knit-slip-on-oat', 0.98],
  ['product', 'Knit slip-on in oat, profile', '/products/knit-slip-on-oat', 0.95],
  ['detail', 'Close view of the knit and midsole join', '/products/knit-slip-on-oat', 0.9],
  ['campaign', 'Late summer lookbook, opening frame', '/lookbook/late-summer', 0.92],
  ['campaign', 'Lookbook still life on clay ground', '/lookbook/late-summer', 0.88],
  ['lifestyle', 'Worn on a doorstep in morning light', '/lookbook/late-summer', 0.85],
  ['product', 'Knit slip-on in charcoal, three-quarter', '/products/knit-slip-on-charcoal', 0.94],
  ['product', 'Canvas low in sand, profile', '/products/canvas-low-sand', 0.9],
  ['editorial', 'Materials essay, opening image', '/pages/materials', 0.8],
  ['detail', 'Heel tab and collar detail', '/products/knit-slip-on-charcoal', 0.86],
  ['product', 'Collection grid tile, oat', '/collections/everyday', 0.72],
  ['product', 'Collection grid tile, charcoal', '/collections/everyday', 0.7],
  ['campaign', 'Homepage hero', '/', 0.9],
  ['lifestyle', 'Studio bench still life', '/lookbook/late-summer', 0.68],
];

async function buildEvidence(page, dir) {
  const host = 'https://fixture-brand.example';
  const refs = [];

  for (const [i, meta] of REF_META.entries()) {
    const [type, alt, src, conf] = meta;
    const id = 'ref_fixture' + String(i).padStart(2, '0');
    let localPath = null;
    let bytes = null;

    // The first ten are "saved locally"; the rest exercise the fallback state
    // for a reference the downloader could not retrieve.
    if (i < REF_SCENES.length) {
      const sc = REF_SCENES[i];
      await page.setContent(sceneHtml({ ...sc, top: '50%', shadow: true }), { waitUntil: 'load' });
      const buf = await page.locator('.stage').screenshot({ type: 'png' });
      localPath = 'crawl/references/' + id + '.png';
      const f = path.join(dir, localPath);
      await fsp.mkdir(path.dirname(f), { recursive: true });
      await fsp.writeFile(f, buf);
      bytes = buf.byteLength;
    }

    refs.push({
      reference_id: id,
      image_url: host + '/cdn/' + id + '.jpg',
      source_page: host + src,
      width: 1024,
      height: 1024,
      reference_type: type,
      local_path: localPath,
      bytes,
      alt,
      confidence: conf,
    });
  }

  const started = new Date(Date.now() - 900000);
  const evidence = {
    brand_url: host,
    domain: 'fixture-brand.example',
    pages: EV_PAGES.map((row) => ({
      url: host + row[0], final_url: host + row[0], status: 200,
      role: row[1], title: row[2], ok: true, error: null,
    })),
    text_evidence: EV_TEXT.map((row) => ({ source_page: host + '/', kind: row[0], text: row[1] })),
    visual_references: refs,
    logo_candidates: [],
    product_examples: refs.filter((r) => r.reference_type === 'product' || r.reference_type === 'detail'),
    campaign_examples: refs.filter((r) => ['campaign', 'lifestyle', 'editorial'].includes(r.reference_type)),
    palette: ['#e9e6e0', '#2f2c29', '#b9b0a4', '#f2efe9', '#6f665c'].map((hex) => ({ hex, source: 'computed-style' })),
    crawl_metadata: {
      started_at: started.toISOString(),
      completed_at: new Date(started.getTime() + 21400).toISOString(),
      duration_ms: 21400,
      pages_visited: EV_PAGES.length,
      pages_failed: 0,
      images_seen: 341,
      images_kept: refs.length,
      truncated: false,
      notes: [],
    },
  };

  const parsed = EvidenceBundleSchema.safeParse(evidence);
  if (!parsed.success) {
    console.error('fixture evidence violates EvidenceBundleSchema:');
    console.error(parsed.error.issues.slice(0, 8).map((i) => '  ' + i.path.join('.') + ': ' + i.message).join('\n'));
    process.exit(1);
  }
  return parsed.data;
}

// ------------------------------------------------------------------ fixtures

const INVARIANTS = [
  { key: 'silhouette', label: 'Silhouette', description: 'Low-profile slip-on with a continuous knit upper and no visible lacing', severity: 'CRITICAL' },
  { key: 'colorway', label: 'Colourway', description: 'Uniform warm oat/mushroom knit with a tonal midsole, no contrast panels', severity: 'CRITICAL' },
  { key: 'sole_geometry', label: 'Sole geometry', description: 'Slim cream midsole, flat tread, subtle upward curve at the toe', severity: 'CRITICAL' },
  { key: 'knit_texture', label: 'Knit texture', description: 'Fine ribbed vertical knit across the whole upper', severity: 'IMPORTANT' },
  { key: 'heel_tab', label: 'Heel tab', description: 'Short flat pull tab in the same knit, centred on the heel', severity: 'IMPORTANT' },
];

const SHOT_BRIEFS = [
  ['Hero three-quarter on seamless ground', 'Soft top light, long even falloff', 'Warm neutral seamless sweep', '85mm at product height, three-quarter'],
  ['Angled profile with directional shadow', 'Single hard source camera left', 'Graded stone gradient', '50mm slightly above axis'],
  ['Macro on the knit and midsole join', 'Raking light across the texture', 'Deep charcoal falloff', '100mm macro, shallow depth'],
  ['Overhead flat composition', 'Diffuse overhead, minimal shadow', 'Pale layered paper', '35mm directly overhead'],
  ['Editorial still life with warm ground', 'Late directional daylight', 'Mid-tone clay surface', '65mm, slight tilt'],
  ['Low-key campaign frame', 'Single soft source, deep shadow', 'Near-black gradient', '85mm, product centred low'],
];

function buildShots(kind) {
  return SCENES.map((s, i) => {
    const [purpose, lighting, background, camera] = SHOT_BRIEFS[i];
    // The partial fixture deliberately carries one blocked shot and one repair,
    // because those states need reviewing as much as the happy path does.
    const blocked = kind === 'partial' && i === 3;
    const repaired = kind === 'partial' && i === 1;
    const attempts = blocked ? 3 : repaired ? 2 : 1;

    const qa = blocked
      ? {
          product_accuracy: 4, realism: 7, brand_alignment: 8, creative_quality: 7,
          critical_checks: { identity: true, geometry: false, color: true, material: true, branding: true },
          invariant_checks: [
            { key: 'silhouette', pass: true, note: 'profile matches the reference' },
            { key: 'colorway', pass: true, note: '' },
            { key: 'sole_geometry', pass: false, note: 'midsole rendered noticeably thicker with a squared toe spring' },
          ],
          issues: [
            'Midsole depth roughly 40% greater than the reference',
            'Toe spring squared off rather than the reference curve',
            '[override] critical identity failure: geometry, sole_geometry; exhausted 2 repair attempts',
          ],
          repair_instruction: 'Restore the slim cream midsole and the gentle upward toe curve from the reference while keeping the current overhead composition and lighting.',
          decision: 'BLOCK',
        }
      : {
          product_accuracy: [9, 8, 9, 8, 9, 8][i],
          realism: [9, 8, 8, 9, 8, 9][i],
          brand_alignment: [9, 9, 8, 8, 9, 9][i],
          creative_quality: [8, 9, 8, 8, 9, 9][i],
          critical_checks: { identity: true, geometry: true, color: true, material: true, branding: true },
          invariant_checks: INVARIANTS.slice(0, 3).map((v) => ({ key: v.key, pass: true, note: 'matches the reference' })),
          issues: repaired ? ['Resolved on the second attempt: knit texture was initially too coarse'] : [],
          repair_instruction: '',
          decision: 'PASS',
        };

    const genAttempts = Array.from({ length: attempts }, (_, a) => ({
      shot_id: s.id,
      attempt: a + 1,
      kind: a === 0 ? 'INITIAL' : 'REPAIR',
      status: 'GENERATED',
      model: 'gpt-image-1',
      prompt_hash: `f1x7ur3${i}${a}`,
      started_at: new Date(Date.now() - 600000 + i * 40000 + a * 12000).toISOString(),
      completed_at: new Date(Date.now() - 600000 + i * 40000 + a * 12000 + 9000).toISOString(),
      output_path: `generations/${s.id.toLowerCase()}/attempt_0${a + 1}.png`,
      error: null,
    }));

    return {
      shot_id: s.id,
      purpose,
      status: blocked ? 'BLOCKED' : 'ACCEPTED',
      contract: {
        shot_id: s.id,
        purpose,
        composition: 'Product occupying the middle third with generous headroom',
        camera,
        framing: 'Square',
        background,
        lighting,
        styling: 'No props, product only',
        product_position: 'Centred, grounded with contact shadow',
        reference_ids: ['ref_a1b2c3d4e5'],
        must_preserve: INVARIANTS.slice(0, 3).map((v) => v.key),
        creative_freedom: ['shadow direction', 'background tone', 'depth of falloff'],
        avoid: ['visible branding that is not on the product', 'busy props'],
      },
      generation_attempts: genAttempts,
      repair_attempts: attempts - 1,
      output: blocked ? `generations/${s.id.toLowerCase()}/attempt_03.png` : `final/${s.id.toLowerCase()}.png`,
      qa,
      qa_history: [qa],
      failure_reason: blocked ? 'Sole geometry drifted from the reference and did not recover after 2 repairs' : null,
    };
  });
}

const BRAND_KIT = {
  brand: {
    name: 'Fixture Brand',
    category: ['footwear', 'apparel'],
    positioning: 'Quiet materials-led footwear sold on comfort and provenance rather than performance claims',
    personality: ['understated', 'tactile', 'unhurried'],
  },
  visual_identity: {
    dominant_colors: ['#e9e6e0', '#2f2c29', '#b9b0a4', '#f2efe9', '#6f665c'],
    accent_colors: ['#8a7f70'],
    background_preferences: ['warm seamless sweep', 'mid-tone clay', 'near-black falloff'],
    contrast: 'low to moderate, with occasional deep low-key frames',
    visual_density: 'sparse, product occupies the middle third',
  },
  photography_language: {
    lighting: [
      { value: 'soft directional daylight with long falloff', basis: 'OBSERVED', evidence_refs: ['ref_a1b2c3d4e5'] },
      { value: 'single-source shaping rather than flat fill', basis: 'INFERRED', evidence_refs: [] },
    ],
    backgrounds: [{ value: 'warm neutral seamless sweeps', basis: 'OBSERVED', evidence_refs: ['ref_a1b2c3d4e5'] }],
    camera_style: [{ value: 'product-height three-quarter, mild telephoto', basis: 'OBSERVED', evidence_refs: [] }],
    framing: [{ value: 'square with generous headroom', basis: 'OBSERVED', evidence_refs: [] }],
    composition: [{ value: 'single product, centred, contact shadow grounding it', basis: 'OBSERVED', evidence_refs: [] }],
    depth_of_field: 'deep except in macro detail frames',
    product_scale: 'middle third of the frame',
    model_usage: 'rare; product-only for catalogue work',
    styling: [{ value: 'no props, no styling clutter', basis: 'OBSERVED', evidence_refs: [] }],
    post_processing: [{ value: 'warm grade, gentle contrast, no heavy retouching', basis: 'INFERRED', evidence_refs: [] }],
  },
  creative_patterns: {
    catalog: ['seamless three-quarter', 'overhead flat'],
    editorial: ['low-key campaign frame'],
    lifestyle: [],
    detail: ['macro on material joins'],
    campaign: ['warm ground still life'],
  },
  brand_rules: [
    'Product is always fully in frame with a visible contact shadow',
    'Backgrounds stay within the warm neutral to near-black range',
    'No text, badges or graphics that are not physically on the product',
  ],
  avoid: ['busy props', 'cool blue grades', 'floating products with no ground contact'],
  confidence: { brand: 0.82, visual_identity: 0.78, photography_language: 0.74, creative_patterns: 0.66 },
  evidence_refs: ['ref_a1b2c3d4e5'],
  _meta: {
    brand_id: 'fixture-brand.example',
    brand_url: 'https://fixture-brand.example',
    brand_profile_version: 'bk-1.0.0',
    created_at: new Date().toISOString(),
    model: 'fixture (no model call)',
    evidence_page_count: 9,
    evidence_image_count: 10,
  },
};

const PRODUCT_IDENTITY = {
  category: 'footwear',
  subcategory: 'knit slip-on sneaker',
  appearance: { colors: ['warm oat', 'cream'], materials: ['fine ribbed knit', 'foam midsole'], texture: ['soft vertical rib'] },
  geometry: { silhouette: 'low-profile slip-on', profile: 'gentle toe spring', aspect_ratio: 'roughly 5:2 wider than tall' },
  construction: ['seamless knit upper', 'bonded midsole', 'flat tread'],
  branding: [{ type: 'none', content: '', placement: '' }],
  distinctive_features: ['continuous knit with no lacing', 'tonal heel pull tab'],
  must_preserve: INVARIANTS,
  uncertain_features: ['exact insole colour', 'outsole tread pattern under the arch'],
  description_for_generation: 'A low-profile warm-oat knit slip-on sneaker with a fine vertical rib across a seamless upper, a slim cream foam midsole with a flat tread and gentle toe spring, and a short tonal knit pull tab centred on the heel. No lacing, no visible branding.',
  confidence: 0.86,
  _meta: { product_asset_id: 'pa_fixture0000000', created_at: new Date().toISOString(), model: 'fixture (no model call)' },
};

const RUN_DEFS = [
  { id: `${PREFIX}complete`, kind: 'complete', status: 'COMPLETED' },
  { id: `${PREFIX}partial`, kind: 'partial', status: 'PARTIAL' },
  { id: `${PREFIX}running`, kind: 'running', status: 'GENERATING' },
  { id: `${PREFIX}failed`, kind: 'failed', status: 'FAILED' },
];

// ---------------------------------------------------------------------- run

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

const indexFile = path.join(RUNS, 'index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
const cleanIndex = index.filter((e) => !e.run_id.startsWith(PREFIX));

for (const def of RUN_DEFS) {
  const dir = path.join(RUNS, def.id);
  fs.rmSync(dir, { recursive: true, force: true });
  await fsp.mkdir(path.join(dir, 'input'), { recursive: true });
  await fsp.copyFile(source, path.join(dir, 'input', 'product.png'));

  const createdAt = new Date(Date.now() - 900000).toISOString();

  if (def.kind === 'failed') {
    // A run that died before generating anything: exercises the failure screen.
    await fsp.writeFile(path.join(dir, 'state.json'), JSON.stringify({
      run_id: def.id,
      status: 'FAILED',
      stage: 'Failed',
      progress: { generated: 0, total: 6, accepted: 0, blocked: 0 },
      input: { brand_url: 'https://fixture-brand.example', product_asset_id: 'pa_fixture0000000', product_mime: 'image/png', workflow_version: 'brandforge-1.0.0', timestamp: createdAt },
      error: 'Not enough evidence to build a brand profile: only 1 usable visual reference (need 3)',
      failure_code: 'INSUFFICIENT_BRAND_EVIDENCE',
      created_at: createdAt,
      updated_at: createdAt,
      completed_at: createdAt,
      usage: { image_generations: 0, repairs: 0, gemini_calls: 1, crawl_pages: 3 },
      errors: [{ code: 'INSUFFICIENT_BRAND_EVIDENCE', message: 'only 1 usable visual reference (need 3)', at: createdAt }],
      fixture: true,
    }, null, 2));
    await fsp.writeFile(path.join(dir, 'events.ndjson'),
      ['RUN_CREATED', 'INPUT_VALIDATED', 'CRAWL_STARTED', 'CRAWL_COMPLETED', 'BRAND_CACHE_MISS', 'RUN_FAILED']
        .map((e, i) => JSON.stringify({ svc: 'api', event: e, run_id: def.id, at: new Date(Date.parse(createdAt) + i * 3000).toISOString() }))
        .join('\n') + '\n');

    // it crawled fine, it just did not find enough to work with
    const thin = await buildEvidence(page, dir);
    thin.visual_references = thin.visual_references.slice(0, 1);
    thin.product_examples = [];
    thin.campaign_examples = [];
    thin.crawl_metadata.pages_visited = 3;
    thin.crawl_metadata.images_kept = 1;
    await fsp.mkdir(path.join(dir, 'crawl'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'crawl', 'evidence.json'), JSON.stringify(thin, null, 2));

    cleanIndex.unshift({ run_id: def.id, brand_url: 'https://fixture-brand.example', brand: null, product_category: null, status: 'FAILED', created_at: createdAt, accepted: 0, blocked: 0 });
    console.log(`seeded ${def.id} (failure state)`);
    continue;
  }

  if (def.kind === 'running') {
    // Three shots through QA, three still to come.
    const shots = buildShots('complete').slice(0, 3);
    for (const [i, sc] of SCENES.slice(0, 3).entries()) {
      await page.setContent(sceneHtml(sc), { waitUntil: 'load' });
      const buf = await page.locator('.stage').screenshot({ type: 'png' });
      const f = path.join(dir, 'final', `${sc.id.toLowerCase()}.png`);
      await fsp.mkdir(path.dirname(f), { recursive: true });
      await fsp.writeFile(f, buf);
      const g = path.join(dir, shots[i].generation_attempts[0].output_path);
      await fsp.mkdir(path.dirname(g), { recursive: true });
      await fsp.writeFile(g, buf);
    }
    await fsp.mkdir(path.join(dir, 'campaign'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'campaign', 'shot-results.json'), JSON.stringify(shots, null, 2));

    const evidence = await buildEvidence(page, dir);
    await fsp.mkdir(path.join(dir, 'crawl'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'crawl', 'evidence.json'), JSON.stringify(evidence, null, 2));
    await fsp.mkdir(path.join(dir, 'intelligence'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'intelligence', 'brand-kit.json'), JSON.stringify(BRAND_KIT, null, 2));
    await fsp.writeFile(path.join(dir, 'intelligence', 'product-identity.json'), JSON.stringify(PRODUCT_IDENTITY, null, 2));

    const startedAt = new Date(Date.now() - 132000).toISOString();
    await fsp.writeFile(path.join(dir, 'state.json'), JSON.stringify({
      run_id: def.id,
      status: 'GENERATING',
      stage: 'Completed 3 / 6',
      progress: { generated: 3, total: 6, accepted: 3, blocked: 0 },
      input: { brand_url: 'https://fixture-brand.example', product_asset_id: 'pa_fixture0000000', product_mime: 'image/png', workflow_version: 'brandforge-1.0.0', timestamp: startedAt },
      brand: 'Fixture Brand',
      product_category: 'footwear',
      error: null,
      failure_code: null,
      created_at: startedAt,
      updated_at: new Date().toISOString(),
      completed_at: null,
      usage: { image_generations: 4, repairs: 1, gemini_calls: 8, crawl_pages: 9 },
      errors: [],
      fixture: true,
    }, null, 2));

    const evs = [
      { event: 'RUN_CREATED' }, { event: 'INPUT_VALIDATED' }, { event: 'CRAWL_STARTED' },
      { event: 'CRAWL_COMPLETED' }, { event: 'BRAND_KIT_ANALYSIS_STARTED' }, { event: 'BRAND_KIT_CREATED' },
      { event: 'PRODUCT_ANALYSIS_STARTED' }, { event: 'PRODUCT_ANALYZED' }, { event: 'CAMPAIGN_PLANNED' },
      { event: 'SHOT_GENERATION_STARTED', shot_id: 'SHOT_01' }, { event: 'SHOT_GENERATED', shot_id: 'SHOT_01' },
      { event: 'SHOT_QA_PASSED', shot_id: 'SHOT_01', decision: 'PASS' }, { event: 'SHOT_ACCEPTED', shot_id: 'SHOT_01' },
      { event: 'SHOT_GENERATED', shot_id: 'SHOT_02' }, { event: 'SHOT_QA_FAILED', shot_id: 'SHOT_02', decision: 'REPAIR' },
      { event: 'SHOT_REPAIR_STARTED', shot_id: 'SHOT_02' }, { event: 'SHOT_ACCEPTED', shot_id: 'SHOT_02' },
      { event: 'SHOT_GENERATED', shot_id: 'SHOT_03' }, { event: 'SHOT_ACCEPTED', shot_id: 'SHOT_03' },
      { event: 'SHOT_GENERATION_STARTED', shot_id: 'SHOT_04' },
    ];
    await fsp.writeFile(path.join(dir, 'events.ndjson'),
      evs.map((e, i) => JSON.stringify({
        svc: 'api', run_id: def.id, ...e,
        at: new Date(Date.parse(startedAt) + i * 6000).toISOString(),
      })).join('\n') + '\n');

    cleanIndex.unshift({
      run_id: def.id, brand_url: 'https://fixture-brand.example', brand: 'Fixture Brand',
      product_category: 'footwear', status: 'GENERATING', created_at: startedAt, accepted: 3, blocked: 0,
    });
    console.log(`seeded ${def.id} (mid-run, 3/6 done)`);
    continue;
  }

  const shots = buildShots(def.kind);

  // Compose the imagery locally.
  for (const [i, s] of SCENES.entries()) {
    await page.setContent(sceneHtml(s), { waitUntil: 'load' });
    const buf = await page.locator('.stage').screenshot({ type: 'png' });
    const shot = shots[i];
    for (const att of shot.generation_attempts) {
      const p = path.join(dir, att.output_path);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, buf);
    }
    if (shot.status === 'ACCEPTED') {
      const f = path.join(dir, 'final', `${s.id.toLowerCase()}.png`);
      await fsp.mkdir(path.dirname(f), { recursive: true });
      await fsp.writeFile(f, buf);
    }
  }

  const evidence = await buildEvidence(page, dir);
  await fsp.mkdir(path.join(dir, 'crawl'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'crawl', 'evidence.json'), JSON.stringify(evidence, null, 2));

  await fsp.mkdir(path.join(dir, 'intelligence'), { recursive: true });
  await fsp.mkdir(path.join(dir, 'campaign'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'intelligence', 'brand-kit.json'), JSON.stringify(BRAND_KIT, null, 2));
  await fsp.writeFile(path.join(dir, 'intelligence', 'product-identity.json'), JSON.stringify(PRODUCT_IDENTITY, null, 2));
  await fsp.writeFile(path.join(dir, 'campaign', 'shot-plan.json'), JSON.stringify({
    rationale: 'Catalogue-led brand with a materials story, so the six weight toward clean product frames plus one macro and one low-key editorial.',
    shots: shots.map((s) => s.contract),
  }, null, 2));

  const accepted = shots.filter((s) => s.status === 'ACCEPTED').length;
  const manifest = {
    run_id: def.id,
    workflow_version: 'brandforge-1.0.0',
    brand_profile_version: 'bk-1.0.0',
    brand: 'Fixture Brand',
    brand_url: 'https://fixture-brand.example',
    brand_id: 'fixture-brand.example',
    product_category: 'footwear',
    product_asset_id: 'pa_fixture0000000',
    models: {
      brand_intelligence: 'fixture (no model call)',
      product_intelligence: 'fixture (no model call)',
      planner: 'fixture (no model call)',
      image: 'fixture (composed locally)',
      qa: 'fixture (no model call)',
    },
    timestamps: { created_at: createdAt, completed_at: new Date().toISOString() },
    usage: {
      image_generations: shots.reduce((n, s) => n + s.generation_attempts.length, 0),
      repairs: shots.reduce((n, s) => n + s.repair_attempts, 0),
      gemini_calls: 11,
      crawl_pages: 9,
    },
    status: def.status,
    accepted,
    blocked: 6 - accepted,
    shots,
    errors: [],
  };

  // The fixture must satisfy the same schema the real pipeline writes.
  const parsed = ManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    console.error(`fixture manifest for ${def.id} violates ManifestSchema:`);
    console.error(parsed.error.issues.slice(0, 8).map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
    process.exit(1);
  }
  await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, fixture: true }, null, 2));

  await fsp.writeFile(path.join(dir, 'state.json'), JSON.stringify({
    run_id: def.id,
    status: def.status,
    stage: def.status === 'COMPLETED' ? 'Campaign ready' : `Campaign ready — ${accepted} accepted, ${6 - accepted} blocked`,
    progress: { generated: 6, total: 6, accepted, blocked: 6 - accepted },
    input: { brand_url: 'https://fixture-brand.example', product_asset_id: 'pa_fixture0000000', product_mime: 'image/png', workflow_version: 'brandforge-1.0.0', timestamp: createdAt },
    brand: 'Fixture Brand',
    product_category: 'footwear',
    error: null,
    failure_code: null,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    usage: manifest.usage,
    errors: [],
    fixture: true,
  }, null, 2));

  const evs = ['RUN_CREATED', 'INPUT_VALIDATED', 'CRAWL_STARTED', 'CRAWL_COMPLETED', 'BRAND_KIT_CREATED', 'PRODUCT_ANALYZED', 'CAMPAIGN_PLANNED',
    ...shots.flatMap((s) => [
      { event: 'SHOT_GENERATED', shot_id: s.shot_id },
      s.status === 'ACCEPTED' ? { event: 'SHOT_ACCEPTED', shot_id: s.shot_id } : { event: 'SHOT_BLOCKED', shot_id: s.shot_id },
    ]),
    'MANIFEST_WRITTEN', 'RUN_COMPLETED'];
  await fsp.writeFile(path.join(dir, 'events.ndjson'),
    evs.map((e, i) => JSON.stringify({
      svc: 'api', run_id: def.id,
      ...(typeof e === 'string' ? { event: e } : e),
      at: new Date(Date.parse(createdAt) + i * 4000).toISOString(),
    })).join('\n') + '\n');

  cleanIndex.unshift({
    run_id: def.id, brand_url: 'https://fixture-brand.example', brand: 'Fixture Brand',
    product_category: 'footwear', status: def.status, created_at: createdAt,
    accepted, blocked: 6 - accepted,
  });
  console.log(`seeded ${def.id} (${accepted}/6 accepted)`);
}

await browser.close();
fs.writeFileSync(indexFile, JSON.stringify(cleanIndex, null, 2));
console.log('\nfixtures ready. remove them with: node scripts/seed-fixtures.mjs --clean');
