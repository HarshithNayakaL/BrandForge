import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { extractJson, parseModelJson, SchemaError } from '../packages/contracts/src/validate.js';

test('parses bare JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test('strips markdown fences', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('```\n{"a":1}\n```'), { a: 1 });
});

test('ignores prose before and after', () => {
  assert.deepEqual(extractJson('Sure! Here is the result:\n{"a":1}\nHope that helps.'), { a: 1 });
});

test('tolerates trailing commas', () => {
  assert.deepEqual(extractJson('{"a":1,"b":[1,2,],}'), { a: 1, b: [1, 2] });
});

test('does not stop at a brace inside a string', () => {
  const v = extractJson('{"a":"a } brace","b":2}');
  assert.deepEqual(v, { a: 'a } brace', b: 2 });
});

test('handles escaped quotes and backslashes', () => {
  assert.deepEqual(extractJson('{"a":"say \\"hi\\"","b":"c:\\\\path"}'), { a: 'say "hi"', b: 'c:\\path' });
});

test('parses a top-level array', () => {
  assert.deepEqual(extractJson('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
});

test('reports truncation distinctly from malformation', () => {
  assert.throws(() => extractJson('{"a":1'), (e) => e instanceof SchemaError && e.code === 'TRUNCATED_JSON');
  assert.throws(() => extractJson('no json at all'), (e) => e instanceof SchemaError && e.code === 'NO_JSON_FOUND');
});

test('schema violations are caught with readable issue paths', () => {
  const schema = z.object({ name: z.string(), count: z.number() });
  assert.throws(
    () => parseModelJson('{"name":"x","count":"not a number"}', schema, 'Test'),
    (e) => e instanceof SchemaError && e.code === 'SCHEMA_VIOLATION' && e.details.issues[0].startsWith('count:')
  );
});

test('valid output passes through', () => {
  const schema = z.object({ name: z.string() });
  assert.deepEqual(parseModelJson('```json\n{"name":"ok"}\n```', schema, 'Test'), { name: 'ok' });
});
