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
  // Canvas: tinted, not neutral. Gen Z design rejects the white/grey default,
  // but frames keep a neutral mat so photo colour stays judgeable.
  paper:         [0.970, 0.020, 305],
  surface:       [0.995, 0.006, 305],
  mat:           [0.965, 0.003, 305],   // inside image frames only
  ink:           [0.200, 0.035, 305],
  'ink-2':       [0.430, 0.035, 305],
  'ink-3':       [0.520, 0.030, 305],
  line:          [0.880, 0.020, 305],
  'line-strong': [0.580, 0.035, 305],

  // Print registration colours, used as real signal not decoration
  cyan:          [0.600, 0.150, 230],   // registration marks, never text
  'cyan-ink':    [0.520, 0.130, 230],   // when cyan has to carry text
  magenta:       [0.570, 0.240, 350],
  'magenta-ink': [0.490, 0.210, 350],   // chip text on a magenta tint
  'magenta-lt':  [0.940, 0.050, 350],
  yellow:        [0.860, 0.170, 95],
  lime:          [0.780, 0.200, 140],
  'lime-ink':    [0.480, 0.140, 145],
  'lime-lt':     [0.950, 0.060, 140],
  'red':         [0.560, 0.220, 25],
  'red-ink':     [0.500, 0.200, 27],
  'red-lt':      [0.945, 0.050, 25],
  'amber-ink':   [0.530, 0.150, 70],
  'amber-lt':    [0.950, 0.080, 80],

  shell:         [0.200, 0.035, 305],
  'shell-2':     [0.290, 0.040, 305],
  'on-shell':    [0.970, 0.010, 305],
  'on-shell-2':  [0.760, 0.030, 305],
};


console.log('\n  token          oklch                       hex');
console.log('  ' + '-'.repeat(58));
for (const [k, v] of Object.entries(P)) {
  console.log(`  ${k.padEnd(13)} oklch(${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2]})`.padEnd(48) + toHex(v));
}

const pairs = [
  ['ink on paper', P.ink, P.paper, 4.5],
  ['ink on surface', P.ink, P.surface, 4.5],
  ['ink on mat', P.ink, P.mat, 4.5],
  ['ink-2 on paper (body)', P['ink-2'], P.paper, 4.5],
  ['ink-3 on paper (labels)', P['ink-3'], P.paper, 4.5],
  ['ink-3 on surface', P['ink-3'], P.surface, 4.5],
  ['white on magenta', [1, 0, 0], P.magenta, 4.5],
  ['magenta on paper (link/active)', P.magenta, P.paper, 4.5],
  ['magenta-ink on magenta-lt (chip)', P['magenta-ink'], P['magenta-lt'], 4.5],
  ['cyan-ink on paper (text)', P['cyan-ink'], P.paper, 4.5],
  ['cyan mark on paper (non-text 3:1)', P.cyan, P.paper, 3.0],
  ['ink on lime (accept btn)', P.ink, P.lime, 4.5],
  ['lime-ink on lime-lt (accepted chip)', P['lime-ink'], P['lime-lt'], 4.5],
  ['red-ink on red-lt (blocked chip)', P['red-ink'], P['red-lt'], 4.5],
  ['red on paper', P.red, P.paper, 4.5],
  ['amber-ink on amber-lt (partial chip)', P['amber-ink'], P['amber-lt'], 4.5],
  ['ink on yellow (highlight)', P.ink, P.yellow, 4.5],
  ['on-shell on shell', P['on-shell'], P.shell, 4.5],
  ['on-shell-2 on shell', P['on-shell-2'], P.shell, 4.5],
  ['on-shell-2 on shell-2', P['on-shell-2'], P['shell-2'], 4.5],
  ['lime on shell (mark)', P.lime, P.shell, 4.5],
  ['line-strong on paper (UI boundary 3:1)', P['line-strong'], P.paper, 3.0],
  ['line on paper (separator)', P.line, P.paper, 1.15],
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
