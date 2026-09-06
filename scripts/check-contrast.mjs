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
  bg:            [0.985, 0.002, 270],
  surface:       [1.000, 0.000, 270],
  sunken:        [0.966, 0.004, 270],
  line:          [0.905, 0.006, 270],
  'line-strong': [0.640, 0.014, 270],
  ink:           [0.235, 0.014, 270],
  'ink-2':       [0.452, 0.012, 270],
  'ink-3':       [0.535, 0.011, 270],
  accent:        [0.480, 0.160, 270],
  'accent-weak': [0.955, 0.020, 270],
  ok:            [0.500, 0.110, 155],
  warn:          [0.520, 0.110, 70],
  danger:        [0.520, 0.170, 25],
};

console.log('\n  token          oklch                       hex');
console.log('  ' + '-'.repeat(58));
for (const [k, v] of Object.entries(P)) {
  console.log(`  ${k.padEnd(13)} oklch(${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2]})`.padEnd(48) + toHex(v));
}

const pairs = [
  ['ink on bg', P.ink, P.bg, 4.5],
  ['ink on surface', P.ink, P.surface, 4.5],
  ['ink-2 on bg', P['ink-2'], P.bg, 4.5],
  ['ink-2 on surface', P['ink-2'], P.surface, 4.5],
  ['ink-3 on bg (labels)', P['ink-3'], P.bg, 4.5],
  ['ink-3 on sunken', P['ink-3'], P.sunken, 4.5],
  ['accent on bg', P.accent, P.bg, 4.5],
  ['accent on surface', P.accent, P.surface, 4.5],
  ['white on accent (button)', [1, 0, 270], P.accent, 4.5],
  ['accent on accent-weak (chip)', P.accent, P['accent-weak'], 4.5],
  ['ok on surface', P.ok, P.surface, 4.5],
  ['warn on surface', P.warn, P.surface, 4.5],
  ['danger on surface', P.danger, P.surface, 4.5],
  ['line-strong on bg (UI boundary 3:1)', P['line-strong'], P.bg, 3.0],
  ['line on bg (decorative separator)', P.line, P.bg, 1.15],
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
