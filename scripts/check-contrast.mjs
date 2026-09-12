/**
 * Verifies the palette's text/background pairs against WCAG AA before the
 * colours are committed to CSS. Converts OKLCH -> sRGB -> relative luminance.
 *
 *   node scripts/check-contrast.mjs
 */

// --- OKLCH -> linear sRGB (Björn Ottosson's oklab reference conversion)
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

const luminance = ([r, g, b]) => 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
const clamp = (v) => Math.max(0, Math.min(1, v));

function contrast(fg, bg) {
  const l1 = luminance(oklchToRgb(...fg));
  const l2 = luminance(oklchToRgb(...bg));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = (c) => {
  const srgb = oklchToRgb(...c).map((v) => {
    const x = clamp(v);
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(clamp(s) * 255);
  });
  return '#' + srgb.map((n) => n.toString(16).padStart(2, '0')).join('');
};

// --- palette (hue 270, the seeded indigo; neutrals carry only a trace of it)
const P = {
  // Swiss Industrial Print: matte unbleached documentation paper, carbon ink,
  // one hazard red. No second accent, no tints.
  paper:         [0.958, 0.004, 95],    // #F4F4F0 newsprint
  paper2:        [0.925, 0.005, 95],    // #EAE8E3 second substrate
  mat:           [0.945, 0.000, 0],     // inside image frames only, neutral
  ink:           [0.150, 0.002, 95],    // carbon
  'ink-2':       [0.400, 0.003, 95],
  'ink-3':       [0.498, 0.004, 95],
  rule:          [0.150, 0.002, 95],    // structural lines are ink, not grey
  red:           [0.528, 0.220, 27],    // aviation hazard
  'red-hot':     [0.650, 0.210, 27],   // only on carbon, never on paper
};



console.log('\n  token          oklch                       hex');
console.log('  ' + '-'.repeat(58));
for (const [k, v] of Object.entries(P)) {
  console.log(`  ${k.padEnd(13)} oklch(${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2]})`.padEnd(48) + toHex(v));
}

const pairs = [
  ['ink on paper', P.ink, P.paper, 4.5],
  ['ink on paper2', P.ink, P.paper2, 4.5],
  ['ink on mat', P.ink, P.mat, 4.5],
  ['ink-2 on paper (body)', P['ink-2'], P.paper, 4.5],
  ['ink-3 on paper (metadata)', P['ink-3'], P.paper, 4.5],
  ['ink-3 on paper2', P['ink-3'], P.paper2, 4.5],
  ['red on paper (alert text)', P.red, P.paper, 4.5],
  ['red on paper2', P.red, P.paper2, 4.5],
  ['paper on ink (inverted block)', P.paper, P.ink, 4.5],
  ['paper on red (hazard block)', P.paper, P.red, 4.5],
  ['red on ink (terminal accent)', P['red-hot'], P.ink, 4.5],
  ['rule on paper (2px structure 3:1)', P.rule, P.paper, 3.0],
];



console.log('\n  pair                            ratio   need   result');
console.log('  ' + '-'.repeat(58));
let fails = 0;
for (const [name, fg, bg, need] of pairs) {
  const r = contrast(fg, bg);
  const pass = r >= need;
  if (!pass) fails++;
  console.log(`  ${name.padEnd(30)} ${r.toFixed(2).padStart(5)}  ${String(need).padStart(5)}   ${pass ? 'pass' : 'FAIL'}`);
}
console.log(`\n  ${pairs.length - fails}/${pairs.length} pass\n`);
process.exit(fails ? 1 : 0);
