/**
 * Structural validation of the exported n8n workflow.
 *
 *   node scripts/check-workflow.mjs
 *
 * Verifies the JSON parses, every connection points at a node that exists,
 * every Code node is syntactically valid JavaScript, node types carry the
 * typeVersions this project targets, and each money-spending HTTP stage has
 * an error path wired to the halt node.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const file = path.resolve('n8n/workflows/brandforge.json');
const problems = [];

let wf;
try {
  wf = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`workflow JSON does not parse: ${e.message}`);
  process.exit(1);
}

const names = new Set(wf.nodes.map((n) => n.name));
if (names.size !== wf.nodes.length) problems.push('duplicate node names');

// connections resolve
for (const [src, conn] of Object.entries(wf.connections)) {
  if (!names.has(src)) problems.push(`connection from unknown node "${src}"`);
  for (const outputs of conn.main ?? []) {
    for (const t of outputs) {
      if (!names.has(t.node)) problems.push(`"${src}" connects to unknown node "${t.node}"`);
    }
  }
}

// every node except the trigger is reachable
const reachable = new Set();
const trigger = wf.nodes.find((n) => n.type.endsWith('.webhook'));
if (!trigger) problems.push('no webhook trigger node');
else {
  const walk = (name) => {
    if (reachable.has(name)) return;
    reachable.add(name);
    for (const outs of wf.connections[name]?.main ?? []) for (const t of outs) walk(t.node);
  };
  walk(trigger.name);
  for (const n of wf.nodes) {
    if (!reachable.has(n.name)) problems.push(`node "${n.name}" is unreachable from the trigger`);
  }
}

// typeVersions this project targets, read from the installed n8n at build time
const EXPECTED = {
  'n8n-nodes-base.webhook': 2.1,
  'n8n-nodes-base.httpRequest': 4.4,
  'n8n-nodes-base.code': 2,
  'n8n-nodes-base.if': 2.3,
  'n8n-nodes-base.respondToWebhook': 1.5,
  'n8n-nodes-base.noOp': 1,
};
for (const n of wf.nodes) {
  if (!(n.type in EXPECTED)) { problems.push(`unexpected node type ${n.type} on "${n.name}"`); continue; }
  if (n.typeVersion !== EXPECTED[n.type]) {
    problems.push(`"${n.name}" is ${n.type} v${n.typeVersion}, expected v${EXPECTED[n.type]}`);
  }
}

// Code nodes must be valid JavaScript
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-wf-'));
let codeNodes = 0;
for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
  codeNodes++;
  const f = path.join(tmp, `${n.id}.js`);
  fs.writeFileSync(f, `(async () => {\n${n.parameters.jsCode}\n})`);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    problems.push(`Code node "${n.name}" has a syntax error: ${String(e.stderr).split('\n')[1] ?? ''}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

// every stage that can spend money needs an error path
const HALT = 'Halt: Stage Failed';
if (!names.has(HALT)) problems.push(`missing "${HALT}" node`);
for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
  const outs = wf.connections[n.name]?.main ?? [];
  const hasErrorPath = outs.length > 1 && outs[1].some((t) => t.node === HALT);
  const continues = n.onError === 'continueRegularOutput';
  if (!hasErrorPath && !continues) {
    problems.push(`HTTP node "${n.name}" has neither an error output to ${HALT} nor continueRegularOutput`);
  }
}

// the webhook must respond before the long work starts
const respond = wf.nodes.find((n) => n.type === 'n8n-nodes-base.respondToWebhook');
if (!respond) problems.push('no respondToWebhook node: the browser would be held open for the whole run');

console.log(`  ${wf.nodes.length} nodes, ${codeNodes} code nodes, ${reachable.size} reachable`);
if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL ${p}`));
  process.exit(1);
}
console.log('  workflow structurally valid');
