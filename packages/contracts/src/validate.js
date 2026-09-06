import { z } from 'zod';

/**
 * LLMs return prose-wrapped JSON, trailing commas, ```json fences, and
 * occasionally a leading apology. This strips all of that before parsing.
 * Throws a typed error so the pipeline can classify the failure.
 */
export class SchemaError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SchemaError';
    this.code = code;
    this.details = details;
  }
}

export function extractJson(raw) {
  if (typeof raw !== 'string') return raw;
  let s = raw.trim();

  // strip markdown fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // slice from first brace/bracket to its matching close
  const start = s.search(/[[{]/);
  if (start === -1) throw new SchemaError('NO_JSON_FOUND', 'Model response contained no JSON', { raw: s.slice(0, 400) });
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new SchemaError('TRUNCATED_JSON', 'Model JSON was truncated', { raw: s.slice(0, 400) });
  let body = s.slice(start, end + 1);

  // tolerate trailing commas
  body = body.replace(/,(\s*[}\]])/g, '$1');

  try {
    return JSON.parse(body);
  } catch (e) {
    throw new SchemaError('MALFORMED_JSON', `Model JSON failed to parse: ${e.message}`, { raw: body.slice(0, 400) });
  }
}

/** Parse + validate a model response in one step. */
export function parseModelJson(raw, schema, label = 'model output') {
  const obj = extractJson(raw);
  const result = schema.safeParse(obj);
  if (!result.success) {
    throw new SchemaError('SCHEMA_VIOLATION', `${label} did not match its schema`, {
      issues: result.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    });
  }
  return result.data;
}

export const zStrArr = z.array(z.string()).default([]);
