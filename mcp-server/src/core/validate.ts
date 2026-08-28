import type { ParamDef } from './types.js';

/** ReDoS guard: reject regex patterns with nested quantifiers or overlapping alternation. */
export function rejectDangerousRegex(pattern: string): void {
  if (/(\([^)]*[+*}]\s*\))[+*{]/.test(pattern))
    throw new ValidationError('regex rejected: nested quantifiers (ReDoS risk)');
  if (/\([^)]*\|[^)]*\)[+*{]/.test(pattern) && /(\w)\|.*\1/.test(pattern))
    throw new ValidationError('regex rejected: overlapping alternation (ReDoS risk)');
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
  closed = false,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (closed) {
    for (const key of Object.keys(raw)) {
      if (!Object.prototype.hasOwnProperty.call(schema, key)) throw new ValidationError(`Unknown param: ${key}`);
    }
  }

  for (const [key, def] of Object.entries(schema)) {
    let val = raw[key];

    if (val === undefined) {
      if (def.required) {
        throw new ValidationError(`Missing required param: ${key}`);
      }
      if (def.default !== undefined) {
        result[key] = def.default;
      }
      continue;
    }
    if (val === null) {
      if (!def.nullable) {
        if (def.required) throw new ValidationError(`Param ${key}: expected ${def.type}, got null`);
        continue;
      }
      result[key] = null;
      continue;
    }

    // Type check
    const actual = Array.isArray(val) ? 'array' : typeof val;
    if (def.type === 'object' || def.type === 'array') {
      if (actual !== def.type) throw new ValidationError(`Param ${key}: expected ${def.type}, got ${actual}`);
    } else if (def.type !== 'unknown') {
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
