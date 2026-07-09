import { z } from 'zod';

/**
 * Robust structured extraction shared by ALL providers (including mock). Handles the
 * failure modes that break nanobrowser's hand-rolled markdown parsing when switching
 * models: <think> reasoning tags, markdown code fences, prose around JSON, trailing
 * commas, single quotes.
 */

export function stripThink(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<\|.*?\|>/g, '')
    .trim();
}

export function stripCodeFences(raw: string): string {
  const fence = raw.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  return raw.trim();
}

/** Find the first balanced JSON object or array in a string. */
export function firstJson(raw: string): string | null {
  const startObj = raw.indexOf('{');
  const startArr = raw.indexOf('[');
  let start = -1;
  let open = '{';
  let close = '}';
  if (startObj === -1 && startArr === -1) return null;
  if (startArr === -1 || (startObj !== -1 && startObj < startArr)) {
    start = startObj;
    open = '{';
    close = '}';
  } else {
    start = startArr;
    open = '[';
    close = ']';
  }
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export function looseRepair(json: string): string {
  return json
    .replace(/,\s*([}\]])/g, '$1') // trailing commas
    .replace(/'/g, '"') // single quotes (best-effort)
    .replace(/(\w+)\s*:/g, (m, key) => (/^"/.test(m) ? m : `"${key}":`)) // unquoted keys (best-effort)
    .replace(/""/g, '"');
}

/**
 * Escape unescaped double quotes INSIDE string values — the classic temp-0 failure
 * when the task itself contains quoted text (search for "Alan Turing") and the model
 * echoes it verbatim into "thought".
 *
 * A quote closes the string only when what follows reads like real JSON structure:
 *   ": …"        (this quote ended a key)
 *   "} / "]      (closed a container)
 *   ", "key":    (next member) — a bare `", then …` is content, not a member.
 */
export function fixUnescapedQuotes(json: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (!inStr) {
      if (ch === '"') inStr = true;
      out += ch;
      continue;
    }
    if (esc) {
      esc = false;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      const rest = json.slice(i + 1);
      const closes =
        /^\s*(?:$|[}\]:])/.test(rest) || // end / container close / key-colon
        /^\s*,\s*(?:"|\{|\[|-?\d|true\b|false\b|null\b|\}|\])/.test(rest); // comma followed by a real member/value
      if (closes) {
        inStr = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

export interface ParseResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** Snippet of the raw response for diagnostics when parsing fails. */
  rawSnippet?: string;
}

export function extractStructured<T>(raw: string, schema: z.ZodType<T>): ParseResult<T> {
  const attempts: string[] = [];
  const cleaned = stripCodeFences(stripThink(raw));
  attempts.push(cleaned);
  const j = firstJson(cleaned);
  if (j) {
    attempts.push(j);
    attempts.push(fixUnescapedQuotes(j));
    attempts.push(looseRepair(j));
    attempts.push(looseRepair(fixUnescapedQuotes(j)));
  }
  // Unescaped quotes also derail firstJson's brace matching — fix first, then slice.
  const fixedWhole = fixUnescapedQuotes(cleaned);
  const jf = firstJson(fixedWhole);
  if (jf) {
    attempts.push(jf);
    attempts.push(looseRepair(jf));
  }
  attempts.push(fixedWhole);
  attempts.push(looseRepair(cleaned));

  let lastErr = 'no json found';
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      const result = schema.safeParse(parsed);
      if (result.success) return { ok: true, data: result.data };
      lastErr = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastErr, rawSnippet: cleaned.slice(0, 240) };
}
