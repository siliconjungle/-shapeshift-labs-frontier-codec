import { hasUnicodeNoncharacter, hasUnpairedSurrogate } from '@shapeshift-labs/frontier/unicode';
import type { CanonicalJsonOptions, JsonValue } from './types.js';

const textEncoder = new TextEncoder();

export function stringifyCanonicalJson(value: JsonValue, options?: CanonicalJsonOptions): string {
  if (!options || options.validate !== false) {
    validateCanonicalJsonValue(value, options);
  }
  return writeCanonicalJson(value);
}

export function encodeCanonicalJson(value: JsonValue, options?: CanonicalJsonOptions): Uint8Array {
  return textEncoder.encode(stringifyCanonicalJson(value, options));
}

function writeCanonicalJson(value): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    const text = JSON.stringify(value);
    if (text === undefined) throw new TypeError('value must be JSON-serializable data');
    return text;
  }

  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0, length = value.length; i < length; i++) {
      if (i !== 0) out += ',';
      out += writeCanonicalJson(value[i]);
    }
    return out + ']';
  }

  const keys = Object.keys(value).sort(compareUtf16);
  let out = '{';
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    if (i !== 0) out += ',';
    out += JSON.stringify(key) + ':' + writeCanonicalJson(value[key]);
  }
  return out + '}';
}

function compareUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateCanonicalJsonValue(value, options?: CanonicalJsonOptions): void {
  const rejectUnsafeIntegers = !!(options && (options.ijson || options.rejectUnsafeIntegers));
  validateCanonicalValue(value, 'value', new Set(), 0, {
    rejectUnsafeIntegers,
    maxDepth: options && options.maxDepth
  });
}

function validateCanonicalValue(value, path, seen, depth, options): void {
  if (options.maxDepth !== undefined) {
    if (!Number.isSafeInteger(options.maxDepth) || options.maxDepth < 0) {
      throw new TypeError('maxDepth option must be a non-negative safe integer');
    }
    if (depth > options.maxDepth) {
      throw new TypeError(path + ' exceeds maximum JSON depth');
    }
  }

  if (value === null || typeof value === 'boolean') return;

  if (typeof value === 'string') {
    validateCanonicalString(value, path);
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(path + ' must be a finite JSON number');
    if (options.rejectUnsafeIntegers && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError(path + ' must be a safe integer for interoperable JSON');
    }
    return;
  }

  if (typeof value !== 'object') throw new TypeError(path + ' must be JSON-serializable data');
  if (seen.has(value)) throw new TypeError(path + ' must not contain a cycle');
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0, length = value.length; i < length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw new TypeError(path + '[' + i + '] must not be a sparse array hole');
      }
      validateCanonicalValue(value[i], path + '[' + i + ']', seen, depth + 1, options);
    }
    seen.delete(value);
    return;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(path + ' must be a plain object, array, or primitive JSON value');
  }

  const keys = Object.keys(value);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    validateCanonicalString(key, path + ' key');
    validateCanonicalValue(value[key], path + '.' + key, seen, depth + 1, options);
  }

  seen.delete(value);
}

function validateCanonicalString(value: string, path: string): void {
  if (hasUnpairedSurrogate(value)) {
    throw new TypeError(path + ' must be a well-formed Unicode string');
  }
  if (hasUnicodeNoncharacter(value)) {
    throw new TypeError(path + ' must not contain Unicode noncharacters');
  }
}
