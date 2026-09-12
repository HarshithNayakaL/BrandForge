/**
 * Fails when the README's Configuration table disagrees with the values the
 * code actually defaults to, or with .env.example.
 *
 *   node scripts/check-config-docs.mjs
 *
 * This exists because the three drifted apart for real: the README documented
 * one Gemini model while the runtime used another, so anyone copying
 * .env.example ran a different model from the one they had just read about.
 * Documentation that can go stale silently is worse than none.
 */
import fs from 'node:fs';
import path from 'node:path';

const readme = fs.readFileSync('README.md', 'utf8');
const envExample = fs.readFileSync('.env.example', 'utf8');
const configSrc = fs.readFileSync(path.join('services', 'api', 'src', 'config.js'), 'utf8');

const problems = [];

// --- README table: | `KEY` | `value` | description |
const documented = new Map();
for (const m of readme.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|\s*(.+?)\s*\|/gm)) {
  const [, key, rawValue] = m;
  const value = rawValue.replace(/`/g, '').trim();
  documented.set(key, value);
}

if (documented.size === 0) problems.push('no Configuration table rows found in README.md');

// --- .env.example: KEY=value
const envValues = new Map();
for (const m of envExample.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) {
  envValues.set(m[1], m[2].trim());
}

// --- config.js: str('KEY', 'default') / num('KEY', 123)
const codeDefaults = new Map();
for (const m of configSrc.matchAll(/\b(?:str|num)\(\s*'([A-Z0-9_]+)'\s*,\s*(?:'([^']*)'|([0-9_]+))/g)) {
  const [, key, strVal, numVal] = m;
  if (codeDefaults.has(key)) continue;   // first occurrence wins
  codeDefaults.set(key, (strVal ?? numVal ?? '').replace(/_/g, ''));
}

// A documented value that names a fallback rather than a literal is prose,
// not a default, so it is checked for consistency of intent only.
const isProse = (v) => /falls back|see |varies|depends/i.test(v);

for (const [key, docValue] of documented) {
  if (isProse(docValue)) {
    if (!codeDefaults.has(key) && !envValues.has(key)) {
      problems.push(`${key}: documented in README but present in neither config.js nor .env.example`);
    }
    continue;
  }

  const code = codeDefaults.get(key);
  const env = envValues.get(key);

  if (code === undefined && env === undefined) {
    problems.push(`${key}: documented as "${docValue}" but not found in config.js or .env.example`);
    continue;
  }
  if (code !== undefined && code !== docValue) {
    problems.push(`${key}: README says "${docValue}", config.js defaults to "${code}"`);
  }
  if (env !== undefined && env !== docValue) {
    problems.push(`${key}: README says "${docValue}", .env.example sets "${env}"`);
  }
}

// Every env var the code reads should appear in .env.example, or a new
// deployment has no way to discover it exists.
for (const key of codeDefaults.keys()) {
  if (!envValues.has(key) && !/^(API_PORT|DATA_DIR|CRAWLER_PORT|WEB_PORT)$/.test(key)) {
    problems.push(`${key}: read by config.js but missing from .env.example`);
  }
}

console.log(`  ${documented.size} documented, ${codeDefaults.size} code defaults, ${envValues.size} in .env.example`);

if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL ${p}`));
  process.exit(1);
}
console.log('  README, config.js and .env.example agree');
