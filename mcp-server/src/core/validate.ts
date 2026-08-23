import type { ParamDef } from './types.js';

interface RegexGroupFrame {
  hasQuantifier: boolean;
  branchHeads: string[];
  branchHead: string;
}

/** ReDoS guard: reject regex patterns with nested quantifiers or overlapping alternation. */
export function rejectDangerousRegex(pattern: string): void {
  const groups: RegexGroupFrame[] = [];
  let inCharacterClass = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '\\') {
      index += 1;
      const frame = groups[groups.length - 1];
      if (frame && !frame.branchHead && index < pattern.length) frame.branchHead = pattern[index];
      continue;
    }
    if (char === '[') {
      inCharacterClass = true;
      continue;
    }
    if (char === ']' && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass) continue;

    if (char === '(') {
      groups.push({ hasQuantifier: false, branchHeads: [], branchHead: '' });
      continue;
    }
    if (char === '|') {
      const frame = groups[groups.length - 1];
      if (frame) {
        frame.branchHeads.push(frame.branchHead);
        frame.branchHead = '';
      }
      continue;
    }
    if (char === ')') {
      const frame = groups.pop();
      if (!frame) continue;
      let next = index + 1;
      while (next < pattern.length && /\s/.test(pattern[next])) next += 1;
      const quantified = next < pattern.length && (pattern[next] === '+' || pattern[next] === '*' || pattern[next] === '{');
      if (quantified && frame.hasQuantifier) {
        throw new ValidationError('regex rejected: nested quantifiers (ReDoS risk)');
      }
      if (quantified && frame.branchHeads.length > 0) {
        const heads = [...frame.branchHeads, frame.branchHead].filter(Boolean);
        if (new Set(heads).size !== heads.length) {
          throw new ValidationError('regex rejected: overlapping alternation (ReDoS risk)');
        }
      }
      const parent = groups[groups.length - 1];
      if (parent && (frame.hasQuantifier || quantified)) parent.hasQuantifier = true;
      continue;
    }

    const frame = groups[groups.length - 1];
    if (!frame) continue;
    if (char === '+' || char === '*' || char === '{') frame.hasQuantifier = true;
    else if (!frame.branchHead && !'^$?.'.includes(char)) frame.branchHead = char;
  }
}

export class ValidationError extends Error {
  code = -32602;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate and coerce params against ParamDef schema.
 * Returns a new params object with defaults applied.
 * Throws ValidationError for missing required params or type mismatches.
 */
export function validateParams(
  schema: Record<string, ParamDef>,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, def] of Object.entries(schema)) {
    let val = raw[key];

    if (val === undefined || val === null) {
      if (def.required) {
        throw new ValidationError(`Missing required param: ${key}`);
      }
      if (def.default !== undefined) {
        result[key] = def.default;
      }
      continue;
    }

    // Type check
    const actual = Array.isArray(val) ? 'array' : typeof val;
    if (def.type !== 'object' && def.type !== 'array' && def.type !== 'unknown') {
      if (actual !== def.type) {
        // Coerce number from string for convenience
        if (def.type === 'number' && typeof val === 'string' && !isNaN(Number(val))) {
          val = Number(val);
        } else if (def.type === 'boolean' && typeof val === 'string') {
          val = val === 'true';
        } else {
          throw new ValidationError(`Param ${key}: expected ${def.type}, got ${actual}`);
        }
      }
    }

    // Enum check
    if (def.enum && def.enum.length > 0) {
      if (!def.enum.includes(val as string)) {
        throw new ValidationError(`Param ${key}: must be one of [${def.enum.join(', ')}], got ${val}`);
      }
    }

    result[key] = val;
  }

  return result;
}
