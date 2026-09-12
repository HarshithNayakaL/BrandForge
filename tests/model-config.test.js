import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The model id must stay a configuration value. If one ever gets hardcoded
 * into pipeline logic, switching models becomes a code change and the
 * Configuration table starts lying, which is exactly the drift these tests
 * are here to prevent.
 */

const configSrc = fs.readFileSync(path.join('services', 'api', 'src', 'config.js'), 'utf8');
const envExample = fs.readFileSync('.env.example', 'utf8');

test('the image model default is the editing-capable 2.5 variant', () => {
  // The pipeline anchors every generation to the uploaded photo through the
  // edits endpoint, so the model chosen has to support editing.
  assert.match(configSrc, /str\('OPENAI_IMAGE_MODEL',\s*'gpt-image-2\.5-sunburst'\)/);
  assert.match(envExample, /^OPENAI_IMAGE_MODEL=gpt-image-2\.5-sunburst$/m);
});

test('the thinking level is configurable and never sends the rejected value', () => {
  const geminiSrc = fs.readFileSync(path.join('services', 'api', 'src', 'ai', 'gemini.js'), 'utf8');
  assert.match(configSrc, /thinkingLevel:\s*str\('GEMINI_THINKING_LEVEL',\s*'low'\)/);
  // "minimal" is not a supported level and errors, so it must be filtered out
  assert.match(geminiSrc, /\['low', 'medium', 'high'\]\.includes/);
  assert.doesNotMatch(geminiSrc, /thinkingLevel:\s*'minimal'/);
});

test('the vision model falls back to the text model rather than to a literal', () => {
  // A separate hardcoded default here would drift the moment GEMINI_MODEL changed.
  assert.match(configSrc, /visionModel:\s*str\('GEMINI_VISION_MODEL',\s*str\('GEMINI_MODEL'/);
});

test('no model id is hardcoded outside the config module', () => {
  const offenders = [];
  const roots = [path.join('services', 'api', 'src'), path.join('services', 'crawler', 'src')];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      if (full.endsWith(`src${path.sep}config.js`)) continue;   // the one place it belongs
      const src = fs.readFileSync(full, 'utf8');
      // strip comments: prose may legitimately name a model
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/['"`](?:gpt-image|gpt-4|gemini)-[0-9]/.test(code)) offenders.push(full);
    }
  };
  roots.forEach(walk);

  assert.deepEqual(offenders, [], `model ids must come from config: ${offenders.join(', ')}`);
});

test('every model is reachable through an env var', () => {
  for (const key of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_VISION_MODEL', 'OPENAI_API_KEY', 'OPENAI_IMAGE_MODEL']) {
    assert.match(envExample, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
});
