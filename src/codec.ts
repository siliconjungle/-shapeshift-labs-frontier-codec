import {
  OP_SET,
  OP_REMOVE,
  OP_TRUNCATE,
  OP_APPEND,
  OP_ASSIGN,
  OP_STRING_SPLICE,
  OP_ARRAY_SPLICE,
  OP_ARRAY_MOVE,
  OP_STRING_COPY,
  OP_ARRAY_ASSIGN,
  OP_ARRAY_OBJECT_ASSIGN,
  OP_ARRAY_TUPLE_ASSIGN,
  OP_ARRAY_OBJECT_FIELD_ASSIGN,
  OP_SCALAR_ARRAY_REPLACE,
  OP_ARRAY_TWO_FIELD_INSERT
} from '@shapeshift-labs/frontier/constants';
import { assertPatch } from '@shapeshift-labs/frontier/patch';
import { setOwnValue } from './object.js';
import type { CodecOptions, Patch } from './types.js';

export { assertPatch } from '@shapeshift-labs/frontier/patch';

const BINARY_MAGIC_0 = 0x6a; // j
const BINARY_MAGIC_1 = 0x64; // d
const BINARY_MAGIC_2 = 0x70; // p
const BINARY_VERSION = 1;
const TAG_NULL = 0;
const TAG_FALSE = 1;
const TAG_TRUE = 2;
const TAG_INT = 3;
const TAG_DOUBLE = 4;
const TAG_STRING = 5;
const TAG_ARRAY = 6;
const TAG_OBJECT = 7;
const TAG_OBJECT_SHAPE = 8;
const TAG_ROOT_STRING_SPLICE_PATCH = 9;
const TAG_PATCH_OPS = 10;
const TAG_RECORD_ARRAY = 11;
const TAG_COLUMNAR_RECORD_ARRAY = 12;
const TAG_ROOT_APPEND_INT_RUN_PATCH = 13;
const TAG_SET_PATH_SHAPE_PATCH = 14;
const TAG_ROOT_ARRAY_OBJECT_VALUE_CHANGED_PATCH = 15;
const TAG_OBJECT_SHAPE_BASE = 16;
const TAG_OBJECT_SHAPE_LIMIT = TAG_OBJECT_SHAPE_BASE + 16;
const TAG_SET_PATH_SHAPE_SIGNED_INT_PATCH = TAG_OBJECT_SHAPE_LIMIT;
const TAG_ROOT_STRING_SPLICE_COPY_PATCH = TAG_SET_PATH_SHAPE_SIGNED_INT_PATCH + 1;
const TAG_ROOT_ARRAY_OBJECT_FIELD_VALUE_CHANGED_PATCH = TAG_ROOT_STRING_SPLICE_COPY_PATCH + 1;
const TAG_SMALL_STRUCTURAL_PATCH = TAG_ROOT_ARRAY_OBJECT_FIELD_VALUE_CHANGED_PATCH + 1;
const TAG_ROOT_REMOVE_ASSIGN_PATCH = TAG_SMALL_STRUCTURAL_PATCH + 1;
const TAG_ASSIGN_OBJECT_PATCH = TAG_ROOT_REMOVE_ASSIGN_PATCH + 1;
const TAG_ROOT_ASSIGN_OBJECT_PATCH = TAG_ASSIGN_OBJECT_PATCH + 1;
const TAG_ARRAY_REPEAT_VALUE = TAG_ROOT_ASSIGN_OBJECT_PATCH + 1;
const TAG_SIGNED_INT_ARRAY = TAG_ARRAY_REPEAT_VALUE + 1;
const TAG_DOUBLE_ARRAY = TAG_SIGNED_INT_ARRAY + 1;
const STRING_NEW = 0;
const STRING_REF = 1;
const STRING_UTF16 = 2;
const RAW_STRING_UTF16_SENTINEL = Number.MAX_SAFE_INTEGER;
const PATH_SEGMENT_INT = 0;
const PATH_SEGMENT_STRING = 1;
const PATH_SHAPE_CONST_INT = 0;
const PATH_SHAPE_CONST_STRING = 1;
const PATH_SHAPE_VAR_INT = 2;
const PATH_SHAPE_VAR_STRING = 3;
const INDEX_LIST_RAW = 0;
const INDEX_LIST_DELTA = 1;
const INDEX_LIST_RUN = 2;
const INDEX_LIST_CHUNKED = 3;
const INDEX_LIST_ARITHMETIC = 4;
const INDEX_LIST_ELIAS_FANO = 5;
const INDEX_RUN_MIN_LENGTH = 4;
const INDEX_CHUNKED_MIN_LENGTH = 8;
const INDEX_ELIAS_FANO_MIN_LENGTH = 32;
const INDEX_ELIAS_FANO_MIN_SAVED_BYTES = 16;
const INDEX_ELIAS_FANO_MAX_LOWER_BITS = 24;
const RECORD_FIELD_GENERIC = 0;
const RECORD_FIELD_CONST = 1;
const RECORD_FIELD_BOOL = 2;
const RECORD_FIELD_SIGNED_INT = 3;
const RECORD_FIELD_STRING = 4;
const ASSIGN_KEYS_RAW = 0;
const ASSIGN_KEYS_NUMERIC_SUFFIX = 1;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_DECODE = makeBase64UrlDecodeTable();

const hasOwn = Object.prototype.hasOwnProperty;
const jsonParse = JSON.parse;
const jsonStringify = JSON.stringify;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const UNPAIRED_SURROGATE_PATTERN = /[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;
const stringIsWellFormed = (String.prototype as { isWellFormed?: () => boolean }).isWellFormed;
const SMALL_ASCII_CODES = new Array(64);
const SERIALIZE_CACHE_MAX_KEYS = 8;
const SERIALIZE_CACHE_MAX_ARRAY_LENGTH = 2048;
const SERIALIZE_CACHE_MAX_ROOT_ARRAY_LENGTH = 64;
const SERIALIZE_CACHE_MAX_DEPTH = 6;
const SERIALIZE_CACHE_STRING_MIN_LENGTH = 32;
const SERIALIZE_CACHE_ARRAY = 1;
const SERIALIZE_CACHE_OBJECT = 2;
const UNSUPPORTED_SERIALIZE_CACHE_VALUE = Symbol('unsupportedSerializeCacheValue');
const serializedPatchCache = new WeakMap<object, {
  op: unknown[];
  path: unknown[];
  pathValues: unknown[];
  value: unknown;
  text: string;
}>();
const serializedSinglePrimitivePatchCache = new WeakMap<object, {
  op: unknown[];
  path: unknown[];
  pathLength: number;
  path0: unknown;
  path1: unknown;
  path2: unknown;
  path3: unknown;
  value: unknown;
  text: string;
}>();
const serializedArrayObjectFieldAssignPatchCache = new WeakMap<object, {
  op: unknown[];
  path: unknown[];
  pathValues: unknown[];
  rows: unknown[];
  rowValues: unknown[];
  fieldPaths: unknown[];
  fieldPathValues: unknown[][];
  values: unknown[];
  valueValues: unknown[];
  text: string;
}>();
const serializedFlatRecordArrayPatchCache = new WeakMap<object, {
  op: unknown[];
  path: unknown[];
  pathValues: unknown[];
  rows: unknown[];
  rowRefs: object[];
  keys: string[];
  values: unknown[];
  text: string;
}>();
const serializedSmallPatchCache = new WeakMap<object, {
  ops: Array<{
    ref: unknown[];
    values: unknown[];
  }>;
  text: string;
}>();
const serializedSmallStructuralPatchCache = new WeakMap<object, {
  op0: unknown[];
  op1: unknown[];
  op2: unknown[];
  path0: unknown[];
  path0Values: unknown[];
  start: unknown;
  deleteCount: unknown;
  insert: unknown[];
  insertValues: unknown[];
  path1: unknown[];
  path1Values: unknown[];
  value1: object;
  value1Keys: string[];
  value1Values: unknown[];
  path2: unknown[];
  path2Values: unknown[];
  value2: unknown;
  text: string;
}>();
const serializedMixedIndexPatchCache = new WeakMap<object, {
  op0: unknown[];
  op1: unknown[];
  op2: unknown[];
  path0: unknown[];
  path0Values: unknown[];
  indexes0: unknown[];
  index0Values: unknown[];
  values0: unknown[];
  value0Values: unknown[];
  path1: unknown[];
  path1Values: unknown[];
  indexes1: unknown[];
  index1Values: unknown[];
  records1: unknown[];
  record1Refs: object[];
  record1Keys: string[];
  record1Values: unknown[];
  path2: unknown[];
  path2Values: unknown[];
  indexes2: unknown[];
  index2Values: unknown[];
  fieldIndexes2: unknown[];
  fieldIndex2Values: unknown[];
  values2: unknown[];
  value2Values: unknown[];
  text: string;
}>();
const serializedPrimitiveOpStreamPatchCache = new WeakMap<object, {
  ops: Array<{
    op: unknown[];
    kind: number;
    path: unknown[];
    pathValues: unknown[];
    value?: unknown;
    start?: unknown;
    deleteCount?: unknown;
    insert?: unknown[];
    insertValues?: unknown[];
  }>;
  text: string;
}>();
const serializedPatchNoCache = new WeakSet<object>();
const FAST_JSON_PATCH_UNSUPPORTED = Symbol('fastJsonPatchUnsupported');
let compactReadOffset = 0;
let fastJsonReadOffset = 0;

export function serializePatch(patch: Patch, options?: CodecOptions): string {
  if (options && options.validate === false) return serializePatchUnchecked(patch);
  assertPatch(patch);
  return serializePatchUnchecked(patch);
}

export function deserializePatch(text: string, options?: CodecOptions): Patch {
  if (options && options.validate === false) {
    const fast = tryDeserializeSmallJsonPatch(text);
    if (fast !== null) return fast;
  }

  const patch = jsonParse(text);
  if (options && options.validate === false) return patch;
  assertPatch(patch);
  return patch;
}

function tryDeserializeSmallJsonPatch(text: string): Patch | null {
  if (text.length === 0 || text.length > 512 || text.charCodeAt(0) !== 0x5b) return null;
  if (text.indexOf('\\') !== -1) return null;
  if (text.indexOf('{') !== -1 && (
    text.indexOf('__proto__') !== -1 ||
    text.indexOf('"constructor"') !== -1 ||
    text.indexOf('"prototype"') !== -1
  )) {
    return null;
  }

  const singlePrimitive = tryDeserializeSinglePrimitiveJsonPatch(text);
  if (singlePrimitive !== null) return singlePrimitive;

  const smallStructural = tryDeserializeSmallStructuralJsonPatch(text);
  if (smallStructural !== null) return smallStructural;

  if (text.length > 128) return null;

  fastJsonReadOffset = 0;
  const value = readFastJsonPatchValue(text, 0);
  if (value === FAST_JSON_PATCH_UNSUPPORTED || fastJsonReadOffset !== text.length || !Array.isArray(value)) {
    return null;
  }
  return value as Patch;
}

function tryDeserializeSinglePrimitiveJsonPatch(text: string): Patch | null {
  if (text.length > 160 || text.charCodeAt(1) !== 0x5b) return null;

  fastJsonReadOffset = 2;
  const code = readFastJsonPatchInteger(text);
  if (code !== OP_SET && code !== OP_ASSIGN) return null;
  if (text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;

  const path = readFastJsonPatchPathArray(text);
  if (path === null || text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;

  const value = readFastJsonPatchPrimitive(text);
  if (value === FAST_JSON_PATCH_UNSUPPORTED) return null;
  if (
    text.charCodeAt(fastJsonReadOffset) !== 0x5d ||
    text.charCodeAt(fastJsonReadOffset + 1) !== 0x5d ||
    fastJsonReadOffset + 2 !== text.length
  ) {
    return null;
  }

  return [[code, path, value]] as Patch;
}

function tryDeserializeSmallStructuralJsonPatch(text: string): Patch | null {
  fastJsonReadOffset = 0;
  if (
    text.charCodeAt(fastJsonReadOffset++) !== 0x5b ||
    text.charCodeAt(fastJsonReadOffset++) !== 0x5b
  ) {
    return null;
  }

  const code0 = readFastJsonPatchInteger(text);
  if (code0 !== OP_ARRAY_SPLICE || text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;
  const path0 = readFastJsonPatchPathArray(text);
  if (path0 === null || text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;
  const start = readFastJsonPatchInteger(text);
  if (start === FAST_JSON_PATCH_UNSUPPORTED || text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;
  const deleteCount = readFastJsonPatchInteger(text);
  if (deleteCount === FAST_JSON_PATCH_UNSUPPORTED || text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;
  const insert = readFastJsonPatchPrimitiveArray(text, 16);
  if (insert === null || !readFastJsonPatchOpSeparator(text)) return null;

  const code1 = readFastJsonPatchInteger(text);
  if (code1 !== OP_ASSIGN || text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;
  const path1 = readFastJsonPatchPathArray(text);
  if (path1 === null || text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;
  const value1 = readFastJsonPatchFlatObject(text, 16);
  if (value1 === null || !readFastJsonPatchOpSeparator(text)) return null;

  const code2 = readFastJsonPatchInteger(text);
  if (code2 !== OP_SET || text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;
  const path2 = readFastJsonPatchPathArray(text);
  if (path2 === null || text.charCodeAt(fastJsonReadOffset) !== 0x2c) return null;
  fastJsonReadOffset++;
  const value2 = readFastJsonPatchPrimitive(text);
  if (value2 === FAST_JSON_PATCH_UNSUPPORTED) return null;
  if (
    text.charCodeAt(fastJsonReadOffset) !== 0x5d ||
    text.charCodeAt(fastJsonReadOffset + 1) !== 0x5d ||
    fastJsonReadOffset + 2 !== text.length
  ) {
    return null;
  }

  return [
    [OP_ARRAY_SPLICE, path0, start, deleteCount, insert],
    [OP_ASSIGN, path1, value1],
    [OP_SET, path2, value2]
  ] as Patch;
}

function readFastJsonPatchOpSeparator(text: string): boolean {
  if (
    text.charCodeAt(fastJsonReadOffset) !== 0x5d ||
    text.charCodeAt(fastJsonReadOffset + 1) !== 0x2c ||
    text.charCodeAt(fastJsonReadOffset + 2) !== 0x5b
  ) {
    return false;
  }
  fastJsonReadOffset += 3;
  return true;
}

function readFastJsonPatchPrimitiveArray(text: string, maxLength: number): unknown[] | null {
  if (text.charCodeAt(fastJsonReadOffset) !== 0x5b) return null;
  fastJsonReadOffset++;
  if (text.charCodeAt(fastJsonReadOffset) === 0x5d) {
    fastJsonReadOffset++;
    return [];
  }

  const out: unknown[] = [];
  while (out.length <= maxLength && fastJsonReadOffset < text.length) {
    const value = readFastJsonPatchPrimitive(text);
    if (value === FAST_JSON_PATCH_UNSUPPORTED) return null;
    out[out.length] = value;
    const next = text.charCodeAt(fastJsonReadOffset);
    if (next === 0x2c) {
      fastJsonReadOffset++;
      continue;
    }
    if (next === 0x5d) {
      fastJsonReadOffset++;
      return out;
    }
    return null;
  }
  return null;
}

function readFastJsonPatchFlatObject(text: string, maxKeys: number): object | null {
  if (text.charCodeAt(fastJsonReadOffset) !== 0x7b) return null;
  fastJsonReadOffset++;
  const out = {};
  if (text.charCodeAt(fastJsonReadOffset) === 0x7d) {
    fastJsonReadOffset++;
    return out;
  }

  let count = 0;
  while (count <= maxKeys && fastJsonReadOffset < text.length) {
    if (text.charCodeAt(fastJsonReadOffset) !== 0x22) return null;
    const key = readFastJsonPatchString(text);
    if (
      key === FAST_JSON_PATCH_UNSUPPORTED ||
      isSerializationSensitiveObjectKey(key as string) ||
      text.charCodeAt(fastJsonReadOffset) !== 0x3a
    ) {
      return null;
    }
    fastJsonReadOffset++;
    const value = readFastJsonPatchPrimitive(text);
    if (value === FAST_JSON_PATCH_UNSUPPORTED) return null;
    setOwnValue(out as any, key as string, value as any);
    count++;

    const next = text.charCodeAt(fastJsonReadOffset);
    if (next === 0x2c) {
      fastJsonReadOffset++;
      continue;
    }
    if (next === 0x7d) {
      fastJsonReadOffset++;
      return out;
    }
    return null;
  }
  return null;
}

function readFastJsonPatchPathArray(text: string): unknown[] | null {
  if (text.charCodeAt(fastJsonReadOffset) !== 0x5b) return null;
  fastJsonReadOffset++;
  if (text.charCodeAt(fastJsonReadOffset) === 0x5d) {
    fastJsonReadOffset++;
    return [];
  }

  const path: unknown[] = [];
  while (path.length <= 4 && fastJsonReadOffset < text.length) {
    const code = text.charCodeAt(fastJsonReadOffset);
    const segment = code === 0x22
      ? readFastJsonPatchString(text)
      : code === 0x2d || (code >= 0x30 && code <= 0x39)
        ? readFastJsonPatchInteger(text)
        : FAST_JSON_PATCH_UNSUPPORTED;
    if (segment === FAST_JSON_PATCH_UNSUPPORTED) return null;
    path[path.length] = segment;

    const next = text.charCodeAt(fastJsonReadOffset);
    if (next === 0x2c) {
      fastJsonReadOffset++;
      continue;
    }
    if (next === 0x5d) {
      fastJsonReadOffset++;
      return path;
    }
    return null;
  }

  return null;
}

function readFastJsonPatchPrimitive(text: string): unknown {
  const code = text.charCodeAt(fastJsonReadOffset);
  if (code === 0x22) return readFastJsonPatchString(text);
  if (code === 0x2d || (code >= 0x30 && code <= 0x39)) return readFastJsonPatchInteger(text);
  if (code === 0x74 && text.startsWith('true', fastJsonReadOffset)) {
    fastJsonReadOffset += 4;
    return true;
  }
  if (code === 0x66 && text.startsWith('false', fastJsonReadOffset)) {
    fastJsonReadOffset += 5;
    return false;
  }
  if (code === 0x6e && text.startsWith('null', fastJsonReadOffset)) {
    fastJsonReadOffset += 4;
    return null;
  }
  return FAST_JSON_PATCH_UNSUPPORTED;
}

function readFastJsonPatchValue(text: string, depth: number): unknown {
  if (depth > 16 || fastJsonReadOffset >= text.length) return FAST_JSON_PATCH_UNSUPPORTED;

  const code = text.charCodeAt(fastJsonReadOffset);
  if (code === 0x5b) return readFastJsonPatchArray(text, depth + 1);
  if (code === 0x7b) return readFastJsonPatchObject(text, depth + 1);
  if (code === 0x22) return readFastJsonPatchString(text);
  if (code === 0x2d || (code >= 0x30 && code <= 0x39)) return readFastJsonPatchInteger(text);
  if (code === 0x74 && text.startsWith('true', fastJsonReadOffset)) {
    fastJsonReadOffset += 4;
    return true;
  }
  if (code === 0x66 && text.startsWith('false', fastJsonReadOffset)) {
    fastJsonReadOffset += 5;
    return false;
  }
  if (code === 0x6e && text.startsWith('null', fastJsonReadOffset)) {
    fastJsonReadOffset += 4;
    return null;
  }
  return FAST_JSON_PATCH_UNSUPPORTED;
}

function readFastJsonPatchArray(text: string, depth: number): unknown {
  fastJsonReadOffset++;
  if (text.charCodeAt(fastJsonReadOffset) === 0x5d) {
    fastJsonReadOffset++;
    return [];
  }

  const out: unknown[] = [];
  while (fastJsonReadOffset < text.length) {
    const value = readFastJsonPatchValue(text, depth);
    if (value === FAST_JSON_PATCH_UNSUPPORTED) return FAST_JSON_PATCH_UNSUPPORTED;
    out[out.length] = value;

    const code = text.charCodeAt(fastJsonReadOffset);
    if (code === 0x2c) {
      fastJsonReadOffset++;
      continue;
    }
    if (code === 0x5d) {
      fastJsonReadOffset++;
      return out;
    }
    return FAST_JSON_PATCH_UNSUPPORTED;
  }
  return FAST_JSON_PATCH_UNSUPPORTED;
}

function readFastJsonPatchObject(text: string, depth: number): unknown {
  fastJsonReadOffset++;
  const out = {};
  if (text.charCodeAt(fastJsonReadOffset) === 0x7d) {
    fastJsonReadOffset++;
    return out;
  }

  while (fastJsonReadOffset < text.length) {
    if (text.charCodeAt(fastJsonReadOffset) !== 0x22) return FAST_JSON_PATCH_UNSUPPORTED;
    const key = readFastJsonPatchString(text);
    if (key === FAST_JSON_PATCH_UNSUPPORTED || text.charCodeAt(fastJsonReadOffset) !== 0x3a) {
      return FAST_JSON_PATCH_UNSUPPORTED;
    }
    if (isSerializationSensitiveObjectKey(key as string)) return FAST_JSON_PATCH_UNSUPPORTED;
    fastJsonReadOffset++;

    const value = readFastJsonPatchValue(text, depth);
    if (value === FAST_JSON_PATCH_UNSUPPORTED) return FAST_JSON_PATCH_UNSUPPORTED;
    setOwnValue(out as any, key as string, value as any);

    const code = text.charCodeAt(fastJsonReadOffset);
    if (code === 0x2c) {
      fastJsonReadOffset++;
      continue;
    }
    if (code === 0x7d) {
      fastJsonReadOffset++;
      return out;
    }
    return FAST_JSON_PATCH_UNSUPPORTED;
  }
  return FAST_JSON_PATCH_UNSUPPORTED;
}

function readFastJsonPatchString(text: string): unknown {
  const start = fastJsonReadOffset + 1;
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x22) {
      fastJsonReadOffset = index + 1;
      return text.slice(start, index);
    }
    if (code === 0x5c || code < 0x20) return FAST_JSON_PATCH_UNSUPPORTED;
    index++;
  }
  return FAST_JSON_PATCH_UNSUPPORTED;
}

function readFastJsonPatchInteger(text: string): unknown {
  let index = fastJsonReadOffset;
  let sign = 1;
  if (text.charCodeAt(index) === 0x2d) {
    sign = -1;
    index++;
  }

  const first = text.charCodeAt(index);
  if (first < 0x30 || first > 0x39) return FAST_JSON_PATCH_UNSUPPORTED;

  let value = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code < 0x30 || code > 0x39) break;
    value = value * 10 + code - 0x30;
    index++;
  }

  const tail = text.charCodeAt(index);
  if (tail === 0x2e || tail === 0x45 || tail === 0x65) return FAST_JSON_PATCH_UNSUPPORTED;

  fastJsonReadOffset = index;
  return sign === -1 ? (value === 0 ? -0 : -value) : value;
}

function serializePatchUnchecked(patch: Patch): string {
  if (serializedPatchNoCache.has(patch as object)) return jsonStringify(patch);
  const primitiveSingleCached = trySerializeCachedSinglePrimitivePatch(patch);
  if (primitiveSingleCached !== null) return primitiveSingleCached;
  const singleObjectCached = trySerializeCachedSingleObjectPatch(patch);
  if (singleObjectCached !== null) return singleObjectCached;
  if (serializedPatchNoCache.has(patch as object)) return jsonStringify(patch);
  const cachedFieldAssign = trySerializeCachedArrayObjectFieldAssignPatch(patch);
  if (cachedFieldAssign !== null) return cachedFieldAssign;
  const cachedFlatRecordArray = trySerializeCachedFlatRecordArrayPatch(patch);
  if (cachedFlatRecordArray !== null) return cachedFlatRecordArray;
  const cachedSmallStructuralPatch = trySerializeCachedSmallStructuralPatch(patch);
  if (cachedSmallStructuralPatch !== null) return cachedSmallStructuralPatch;
  const cachedMixedIndexPatch = trySerializeCachedMixedIndexPatch(patch);
  if (cachedMixedIndexPatch !== null) return cachedMixedIndexPatch;
  const cachedPrimitiveOpStream = trySerializeCachedPrimitiveOpStreamPatch(patch);
  if (cachedPrimitiveOpStream !== null) return cachedPrimitiveOpStream;
  const cachedSmallPatch = trySerializeCachedSmallPatch(patch);
  if (cachedSmallPatch !== null) return cachedSmallPatch;
  const cached = trySerializeCachedSingleStablePatch(patch);
  if (cached !== null) return cached;
  return jsonStringify(patch);
}

function trySerializeCachedSingleObjectPatch(patch: Patch): string | null {
  if (!Array.isArray(patch) || patch.length !== 1) return null;
  const op = patch[0] as unknown[];
  if (!Array.isArray(op) || op.length !== 3) return null;
  const code = op[0];
  if (code !== OP_SET && code !== OP_ASSIGN) return null;
  const value = op[2];
  if (Array.isArray(value)) return null;
  return trySerializeCachedSingleStablePatch(patch);
}

function trySerializeCachedSinglePrimitivePatch(patch: Patch): string | null {
  if (!Array.isArray(patch) || patch.length !== 1) return null;
  const existing = serializedSinglePrimitivePatchCache.get(patch);
  if (existing !== undefined && isValidSerializedSinglePrimitivePatchCache(existing, patch)) {
    return existing.text;
  }

  const op = patch[0] as unknown[];
  if (!Array.isArray(op) || op.length !== 3) return null;
  const code = op[0];
  if (code !== OP_SET && code !== OP_ASSIGN) return null;
  const path = op[1] as unknown[];
  const value = op[2];
  if (!isPrimitiveJsonScalar(value)) return null;
  if (!Array.isArray(path) || path.length > 4 || !isPrimitiveSegmentArray(path)) return null;

  const entry = {
    op,
    path,
    pathLength: path.length,
    path0: path[0],
    path1: path[1],
    path2: path[2],
    path3: path[3],
    value,
    text: jsonStringify(patch)
  };
  serializedSinglePrimitivePatchCache.set(patch, entry);
  return entry.text;
}

function isValidSerializedSinglePrimitivePatchCache(entry, patch: Patch): boolean {
  const op = patch[0] as unknown[];
  return (
    op === entry.op &&
    op.length === 3 &&
    (op[0] === OP_SET || op[0] === OP_ASSIGN) &&
    op[1] === entry.path &&
    entry.path.length === entry.pathLength &&
    Object.is(op[2], entry.value) &&
    (entry.pathLength < 1 || Object.is(entry.path[0], entry.path0)) &&
    (entry.pathLength < 2 || Object.is(entry.path[1], entry.path1)) &&
    (entry.pathLength < 3 || Object.is(entry.path[2], entry.path2)) &&
    (entry.pathLength < 4 || Object.is(entry.path[3], entry.path3))
  );
}

function trySerializeCachedArrayObjectFieldAssignPatch(patch: Patch): string | null {
  if (!Array.isArray(patch) || patch.length !== 1) return null;
  const op = patch[0] as unknown[];
  if (!Array.isArray(op) || op.length !== 5 || op[0] !== OP_ARRAY_OBJECT_FIELD_ASSIGN) return null;

  const existing = serializedArrayObjectFieldAssignPatchCache.get(patch);
  if (existing !== undefined && isValidSerializedArrayObjectFieldAssignCache(existing, op)) {
    return existing.text;
  }

  const entry = createSerializedArrayObjectFieldAssignPatchCacheEntry(patch, op);
  if (entry === null) return null;
  serializedArrayObjectFieldAssignPatchCache.set(patch, entry);
  return entry.text;
}

function trySerializeCachedFlatRecordArrayPatch(patch: Patch): string | null {
  if (!Array.isArray(patch) || patch.length !== 1) return null;
  const op = patch[0] as unknown[];
  if (!Array.isArray(op) || op.length !== 3) return null;
  const code = op[0];
  if (code !== OP_SET && code !== OP_ASSIGN) return null;
  const rows = op[2] as unknown[];
  if (!Array.isArray(rows) || rows.length < 16 || rows.length > 2048) return null;

  const existing = serializedFlatRecordArrayPatchCache.get(patch);
  if (existing !== undefined && isValidSerializedFlatRecordArrayPatchCache(existing, op)) {
    return existing.text;
  }

  const entry = createSerializedFlatRecordArrayPatchCacheEntry(patch, op);
  if (entry === null) return null;
  serializedFlatRecordArrayPatchCache.set(patch, entry);
  return entry.text;
}

function trySerializeCachedMixedIndexPatch(patch: Patch): string | null {
  if (!Array.isArray(patch) || patch.length !== 3) return null;
  const op0 = patch[0] as unknown[];
  const op1 = patch[1] as unknown[];
  const op2 = patch[2] as unknown[];
  if (
    !Array.isArray(op0) || op0.length !== 4 || op0[0] !== OP_ARRAY_ASSIGN ||
    !Array.isArray(op1) || op1.length !== 4 || op1[0] !== OP_ARRAY_OBJECT_ASSIGN ||
    !Array.isArray(op2) || op2.length !== 5 || op2[0] !== OP_ARRAY_TUPLE_ASSIGN
  ) {
    return null;
  }

  const existing = serializedMixedIndexPatchCache.get(patch);
  if (existing !== undefined && isValidSerializedMixedIndexPatchCache(existing, op0, op1, op2)) {
    return existing.text;
  }

  const entry = createSerializedMixedIndexPatchCacheEntry(patch, op0, op1, op2);
  if (entry === null) return null;
  serializedMixedIndexPatchCache.set(patch, entry);
  return entry.text;
}

function trySerializeCachedPrimitiveOpStreamPatch(patch: Patch): string | null {
  if (!Array.isArray(patch) || patch.length < 4 || patch.length > 2048) return null;

  const existing = serializedPrimitiveOpStreamPatchCache.get(patch);
  if (existing !== undefined && isValidSerializedPrimitiveOpStreamPatchCache(existing, patch)) {
    return existing.text;
  }

  const entry = createSerializedPrimitiveOpStreamPatchCacheEntry(patch);
  if (entry === null) return null;
  serializedPrimitiveOpStreamPatchCache.set(patch, entry);
  return entry.text;
}

function trySerializeCachedSmallPatch(patch: Patch): string | null {
  if (!Array.isArray(patch) || patch.length < 2 || patch.length > 3) return null;

  const existing = serializedSmallPatchCache.get(patch);
  if (existing !== undefined && isValidSerializedSmallPatchCache(existing, patch)) {
    return existing.text;
  }

  const entry = createSerializedSmallPatchCacheEntry(patch);
  if (entry === null) return null;
  serializedSmallPatchCache.set(patch, entry);
  return entry.text;
}

function trySerializeCachedSmallStructuralPatch(patch: Patch): string | null {
  if (!Array.isArray(patch) || patch.length !== 3) return null;
  const op0 = patch[0] as unknown[];
  const op1 = patch[1] as unknown[];
  const op2 = patch[2] as unknown[];
  if (
    !Array.isArray(op0) || op0.length !== 5 || op0[0] !== OP_ARRAY_SPLICE ||
    !Array.isArray(op1) || op1.length !== 3 || op1[0] !== OP_ASSIGN ||
    !Array.isArray(op2) || op2.length !== 3 || op2[0] !== OP_SET
  ) {
    return null;
  }

  const existing = serializedSmallStructuralPatchCache.get(patch);
  if (existing !== undefined && isValidSerializedSmallStructuralPatchCache(existing, op0, op1, op2)) {
    return existing.text;
  }

  const entry = createSerializedSmallStructuralPatchCacheEntry(patch, op0, op1, op2);
  if (entry === null) return null;
  serializedSmallStructuralPatchCache.set(patch, entry);
  return entry.text;
}

function createSerializedSmallStructuralPatchCacheEntry(patch: Patch, op0: unknown[], op1: unknown[], op2: unknown[]) {
  const path0 = op0[1] as unknown[];
  const start = op0[2];
  const deleteCount = op0[3];
  const insert = op0[4] as unknown[];
  const path1 = op1[1] as unknown[];
  const value1 = op1[2] as object;
  const path2 = op2[1] as unknown[];
  const value2 = op2[2];
  if (
    !Array.isArray(path0) || path0.length > 4 || !isPrimitiveSegmentArray(path0) ||
    typeof start !== 'number' ||
    typeof deleteCount !== 'number' ||
    !isCacheablePrimitiveArray(insert, 8) ||
    !Array.isArray(path1) || path1.length > 4 || !isPrimitiveSegmentArray(path1) ||
    value1 === null || typeof value1 !== 'object' || Array.isArray(value1) ||
    !Array.isArray(path2) || path2.length > 4 || !isPrimitiveSegmentArray(path2) ||
    !isPrimitiveJsonScalar(value2)
  ) {
    return null;
  }

  const value1Keys = Object.keys(value1);
  if (value1Keys.length === 0 || value1Keys.length > SERIALIZE_CACHE_MAX_KEYS) return null;
  const value1Values = new Array<unknown>(value1Keys.length);
  if (!readFlatRecordValues(value1 as Record<string, unknown>, value1Keys, value1Values, 0)) return null;

  return {
    op0,
    op1,
    op2,
    path0,
    path0Values: path0.slice(),
    start,
    deleteCount,
    insert,
    insertValues: insert.slice(),
    path1,
    path1Values: path1.slice(),
    value1,
    value1Keys,
    value1Values,
    path2,
    path2Values: path2.slice(),
    value2,
    text: jsonStringify(patch)
  };
}

function isValidSerializedSmallStructuralPatchCache(entry, op0: unknown[], op1: unknown[], op2: unknown[]): boolean {
  return (
    entry.op0 === op0 &&
    entry.op1 === op1 &&
    entry.op2 === op2 &&
    op0.length === 5 &&
    op1.length === 3 &&
    op2.length === 3 &&
    op0[0] === OP_ARRAY_SPLICE &&
    op1[0] === OP_ASSIGN &&
    op2[0] === OP_SET &&
    op0[1] === entry.path0 &&
    op1[1] === entry.path1 &&
    op2[1] === entry.path2 &&
    op0[4] === entry.insert &&
    op1[2] === entry.value1 &&
    Object.is(op0[2], entry.start) &&
    Object.is(op0[3], entry.deleteCount) &&
    Object.is(op2[2], entry.value2) &&
    matchesPrimitiveArray(entry.path0, entry.path0Values) &&
    matchesPrimitiveArray(entry.insert, entry.insertValues) &&
    matchesPrimitiveArray(entry.path1, entry.path1Values) &&
    matchesFlatRecordValues(entry.value1 as Record<string, unknown>, entry.value1Keys, entry.value1Values, 0) &&
    matchesPrimitiveArray(entry.path2, entry.path2Values)
  );
}

function trySerializeCachedSingleStablePatch(patch: Patch): string | null {
  if (serializedPatchNoCache.has(patch as object)) return null;
  if (!Array.isArray(patch) || patch.length !== 1) return markSerializedPatchNoCache(patch);
  const op = patch[0] as unknown[];
  if (!Array.isArray(op) || op.length !== 3) return markSerializedPatchNoCache(patch);
  const code = op[0];
  if (code !== OP_SET && code !== OP_ASSIGN) return markSerializedPatchNoCache(patch);
  const path = op[1] as unknown[];
  if (!Array.isArray(path) || path.length > 4) return markSerializedPatchNoCache(patch);
  for (let i = 0, length = path.length; i < length; i++) {
    const segmentType = typeof path[i];
    if (segmentType !== 'string' && segmentType !== 'number') return markSerializedPatchNoCache(patch);
  }
  const value = op[2];

  const existing = serializedPatchCache.get(patch);
  if (existing !== undefined && isValidSerializedSinglePatchCache(existing, op, path, value)) {
    return existing.text;
  }

  const entry = createSerializedSinglePatchCacheEntry(patch, op, path, value);
  if (entry === null) {
    markSerializedPatchNoCache(patch);
    return null;
  }
  serializedPatchCache.set(patch, entry);
  return entry.text;
}

function createSerializedFlatRecordArrayPatchCacheEntry(patch: Patch, op: unknown[]) {
  const path = op[1] as unknown[];
  const rows = op[2] as unknown[];
  if (!Array.isArray(path) || path.length > 4 || !isPrimitiveSegmentArray(path)) return null;
  const flatRecords = createFlatRecordArrayCacheValues(rows, 2048);
  if (flatRecords === null) return null;

  return {
    op,
    path,
    pathValues: path.slice(),
    rows,
    rowRefs: flatRecords.rowRefs,
    keys: flatRecords.keys,
    values: flatRecords.values,
    text: jsonStringify(patch)
  };
}

function isValidSerializedFlatRecordArrayPatchCache(entry, op: unknown[]): boolean {
  if (entry.op !== op || op.length !== 3) return false;
  const path = op[1] as unknown[];
  const rows = op[2] as unknown[];
  if (path !== entry.path || rows !== entry.rows) return false;
  if (!matchesPrimitiveArray(path, entry.pathValues)) return false;
  if (!Array.isArray(rows) || rows.length !== entry.rowRefs.length) return false;

  const keys = entry.keys;
  const keyCount = keys.length;
  for (let i = 0, rowCount = rows.length; i < rowCount; i++) {
    const row = rows[i];
    if (row !== entry.rowRefs[i] || row === null || typeof row !== 'object' || Array.isArray(row)) return false;
    if (!matchesFlatRecordValues(row as Record<string, unknown>, keys, entry.values, i * keyCount)) return false;
  }
  return true;
}

function createFlatRecordArrayCacheValues(rows: unknown[], maxRows: number) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > maxRows) return null;
  const firstRow = rows[0];
  if (firstRow === null || typeof firstRow !== 'object' || Array.isArray(firstRow)) return null;
  const keys = Object.keys(firstRow as object);
  const keyCount = keys.length;
  if (keyCount === 0 || keyCount > SERIALIZE_CACHE_MAX_KEYS) return null;

  const rowRefs = new Array<object>(rows.length);
  const values = new Array<unknown>(rows.length * keyCount);
  for (let i = 0, rowCount = rows.length; i < rowCount; i++) {
    const row = rows[i];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    rowRefs[i] = row as object;
    if (!readFlatRecordValues(row as Record<string, unknown>, keys, values, i * keyCount)) return null;
  }

  return { rowRefs, keys, values };
}

function matchesFlatRecordArray(rows: unknown[], rowRefs: object[], keys: string[], values: unknown[]): boolean {
  if (!Array.isArray(rows) || rows.length !== rowRefs.length) return false;
  const keyCount = keys.length;
  for (let i = 0, rowCount = rows.length; i < rowCount; i++) {
    const row = rows[i];
    if (row !== rowRefs[i] || row === null || typeof row !== 'object' || Array.isArray(row)) return false;
    if (!matchesFlatRecordValues(row as Record<string, unknown>, keys, values, i * keyCount)) return false;
  }
  return true;
}

function readFlatRecordValues(row: Record<string, unknown>, keys: string[], out: unknown[], offset: number): boolean {
  let index = 0;
  for (const key in row) {
    if (!hasOwn.call(row, key)) continue;
    if (key !== keys[index]) return false;
    const value = row[key];
    const type = typeof value;
    if (value !== null && type !== 'string' && type !== 'number' && type !== 'boolean') return false;
    out[offset + index] = value;
    index++;
  }
  return index === keys.length;
}

function matchesFlatRecordValues(row: Record<string, unknown>, keys: string[], cached: unknown[], offset: number): boolean {
  let index = 0;
  for (const key in row) {
    if (!hasOwn.call(row, key)) continue;
    if (key !== keys[index]) return false;
    if (!Object.is(row[key], cached[offset + index])) return false;
    index++;
  }
  return index === keys.length;
}

function createSerializedArrayObjectFieldAssignPatchCacheEntry(patch: Patch, op: unknown[]) {
  const path = op[1] as unknown[];
  const rows = op[2] as unknown[];
  const fieldPaths = op[3] as unknown[];
  const values = op[4] as unknown[];
  if (!Array.isArray(path) || path.length > 4) return null;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 2048) return null;
  if (!Array.isArray(fieldPaths) || fieldPaths.length === 0 || fieldPaths.length > 16) return null;
  if (!Array.isArray(values) || values.length === 0 || values.length > 8192) return null;

  if (!isPrimitiveSegmentArray(path)) return null;
  if (!isPrimitiveValueArray(rows)) return null;
  if (!isPrimitiveValueArray(values)) return null;

  const fieldPathValues = new Array<unknown[]>(fieldPaths.length);
  for (let i = 0, length = fieldPaths.length; i < length; i++) {
    const fieldPath = fieldPaths[i] as unknown[];
    if (!Array.isArray(fieldPath) || fieldPath.length === 0 || fieldPath.length > 4) return null;
    if (!isPrimitiveSegmentArray(fieldPath)) return null;
    fieldPathValues[i] = fieldPath.slice();
  }

  return {
    op,
    path,
    pathValues: path.slice(),
    rows,
    rowValues: rows.slice(),
    fieldPaths,
    fieldPathValues,
    values,
    valueValues: values.slice(),
    text: jsonStringify(patch)
  };
}

function isValidSerializedArrayObjectFieldAssignCache(entry, op: unknown[]): boolean {
  if (entry.op !== op || op.length !== 5 || op[0] !== OP_ARRAY_OBJECT_FIELD_ASSIGN) return false;
  const path = op[1] as unknown[];
  const rows = op[2] as unknown[];
  const fieldPaths = op[3] as unknown[];
  const values = op[4] as unknown[];
  if (path !== entry.path || rows !== entry.rows || fieldPaths !== entry.fieldPaths || values !== entry.values) return false;
  if (!matchesPrimitiveArray(path, entry.pathValues)) return false;
  if (!matchesPrimitiveArray(rows, entry.rowValues)) return false;
  if (!matchesPrimitiveArray(values, entry.valueValues)) return false;
  if (fieldPaths.length !== entry.fieldPathValues.length) return false;
  for (let i = 0, length = fieldPaths.length; i < length; i++) {
    const fieldPath = fieldPaths[i] as unknown[];
    if (!Array.isArray(fieldPath) || !matchesPrimitiveArray(fieldPath, entry.fieldPathValues[i])) return false;
  }
  return true;
}

function createSerializedMixedIndexPatchCacheEntry(patch: Patch, op0: unknown[], op1: unknown[], op2: unknown[]) {
  const path0 = op0[1] as unknown[];
  const indexes0 = op0[2] as unknown[];
  const values0 = op0[3] as unknown[];
  const path1 = op1[1] as unknown[];
  const indexes1 = op1[2] as unknown[];
  const records1 = op1[3] as unknown[];
  const path2 = op2[1] as unknown[];
  const indexes2 = op2[2] as unknown[];
  const fieldIndexes2 = op2[3] as unknown[];
  const values2 = op2[4] as unknown[];

  if (
    !isCacheablePrimitiveArray(path0, 4) ||
    !isCacheablePrimitiveArray(indexes0, 4096) ||
    !isCacheablePrimitiveArray(values0, 4096) ||
    !isCacheablePrimitiveArray(path1, 4) ||
    !isCacheablePrimitiveArray(indexes1, 4096) ||
    !isCacheablePrimitiveArray(path2, 4) ||
    !isCacheablePrimitiveArray(indexes2, 4096) ||
    !isCacheablePrimitiveArray(fieldIndexes2, 4096) ||
    !isCacheablePrimitiveArray(values2, 4096)
  ) {
    return null;
  }

  const flatRecords = createFlatRecordArrayCacheValues(records1, 4096);
  if (flatRecords === null) return null;

  return {
    op0,
    op1,
    op2,
    path0,
    path0Values: path0.slice(),
    indexes0,
    index0Values: indexes0.slice(),
    values0,
    value0Values: values0.slice(),
    path1,
    path1Values: path1.slice(),
    indexes1,
    index1Values: indexes1.slice(),
    records1,
    record1Refs: flatRecords.rowRefs,
    record1Keys: flatRecords.keys,
    record1Values: flatRecords.values,
    path2,
    path2Values: path2.slice(),
    indexes2,
    index2Values: indexes2.slice(),
    fieldIndexes2,
    fieldIndex2Values: fieldIndexes2.slice(),
    values2,
    value2Values: values2.slice(),
    text: jsonStringify(patch)
  };
}

function isValidSerializedMixedIndexPatchCache(entry, op0: unknown[], op1: unknown[], op2: unknown[]): boolean {
  if (op0 !== entry.op0 || op1 !== entry.op1 || op2 !== entry.op2) return false;
  if (
    op0.length !== 4 || op0[0] !== OP_ARRAY_ASSIGN ||
    op1.length !== 4 || op1[0] !== OP_ARRAY_OBJECT_ASSIGN ||
    op2.length !== 5 || op2[0] !== OP_ARRAY_TUPLE_ASSIGN
  ) {
    return false;
  }

  if (
    op0[1] !== entry.path0 ||
    op0[2] !== entry.indexes0 ||
    op0[3] !== entry.values0 ||
    op1[1] !== entry.path1 ||
    op1[2] !== entry.indexes1 ||
    op1[3] !== entry.records1 ||
    op2[1] !== entry.path2 ||
    op2[2] !== entry.indexes2 ||
    op2[3] !== entry.fieldIndexes2 ||
    op2[4] !== entry.values2
  ) {
    return false;
  }

  return (
    matchesPrimitiveArray(entry.path0, entry.path0Values) &&
    matchesPrimitiveArray(entry.indexes0, entry.index0Values) &&
    matchesPrimitiveArray(entry.values0, entry.value0Values) &&
    matchesPrimitiveArray(entry.path1, entry.path1Values) &&
    matchesPrimitiveArray(entry.indexes1, entry.index1Values) &&
    matchesFlatRecordArray(entry.records1, entry.record1Refs, entry.record1Keys, entry.record1Values) &&
    matchesPrimitiveArray(entry.path2, entry.path2Values) &&
    matchesPrimitiveArray(entry.indexes2, entry.index2Values) &&
    matchesPrimitiveArray(entry.fieldIndexes2, entry.fieldIndex2Values) &&
    matchesPrimitiveArray(entry.values2, entry.value2Values)
  );
}

function createSerializedPrimitiveOpStreamPatchCacheEntry(patch: Patch) {
  const ops = new Array<{
    op: unknown[];
    kind: number;
    path: unknown[];
    pathValues: unknown[];
    value?: unknown;
    start?: unknown;
    deleteCount?: unknown;
    insert?: unknown[];
    insertValues?: unknown[];
  }>(patch.length);

  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i] as unknown[];
    if (!Array.isArray(op)) return null;
    const code = op[0];
    const path = op[1] as unknown[];
    if (!isCacheablePrimitiveArray(path, 8)) return null;

    if (code === OP_SET && op.length === 3 && isPrimitiveJsonScalar(op[2])) {
      ops[i] = {
        op,
        kind: OP_SET,
        path,
        pathValues: path.slice(),
        value: op[2]
      };
      continue;
    }

    const insert = op[4] as unknown[];
    if (
      code === OP_ARRAY_SPLICE &&
      op.length === 5 &&
      isPrimitiveJsonScalar(op[2]) &&
      isPrimitiveJsonScalar(op[3]) &&
      isCacheablePrimitiveArray(insert, 512)
    ) {
      ops[i] = {
        op,
        kind: OP_ARRAY_SPLICE,
        path,
        pathValues: path.slice(),
        start: op[2],
        deleteCount: op[3],
        insert,
        insertValues: insert.slice()
      };
      continue;
    }

    return null;
  }

  return {
    ops,
    text: jsonStringify(patch)
  };
}

function isValidSerializedPrimitiveOpStreamPatchCache(entry, patch: Patch): boolean {
  if (patch.length !== entry.ops.length) return false;
  for (let i = 0, length = entry.ops.length; i < length; i++) {
    const cached = entry.ops[i];
    const op = patch[i] as unknown[];
    if (op !== cached.op || !Array.isArray(op) || op[0] !== cached.kind || op[1] !== cached.path) return false;
    if (!matchesPrimitiveArray(cached.path, cached.pathValues)) return false;

    if (cached.kind === OP_SET) {
      if (op.length !== 3 || !Object.is(op[2], cached.value)) return false;
      continue;
    }

    const insert = op[4] as unknown[];
    if (
      op.length !== 5 ||
      !Object.is(op[2], cached.start) ||
      !Object.is(op[3], cached.deleteCount) ||
      insert !== cached.insert ||
      !Array.isArray(insert) ||
      !matchesPrimitiveArray(insert, cached.insertValues as unknown[])
    ) {
      return false;
    }
  }
  return true;
}

function createSerializedSmallPatchCacheEntry(patch: Patch) {
  const ops = new Array<{ ref: unknown[]; values: unknown[] }>(patch.length);
  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i] as unknown[];
    if (!Array.isArray(op) || op.length < 2 || op.length > 5) return null;
    const values = new Array<unknown>(op.length);
    for (let j = 0, opLength = op.length; j < opLength; j++) {
      const cached = readSmallSerializeCacheValue(op[j]);
      if (cached === UNSUPPORTED_SERIALIZE_CACHE_VALUE) return null;
      values[j] = cached;
    }
    ops[i] = { ref: op, values };
  }
  return {
    ops,
    text: jsonStringify(patch)
  };
}

function isValidSerializedSmallPatchCache(entry, patch: Patch): boolean {
  if (patch.length !== entry.ops.length) return false;
  for (let i = 0, length = entry.ops.length; i < length; i++) {
    const op = patch[i] as unknown[];
    const cachedOp = entry.ops[i];
    if (op !== cachedOp.ref || !Array.isArray(op) || op.length !== cachedOp.values.length) return false;
    for (let j = 0, opLength = op.length; j < opLength; j++) {
      if (!isValidSmallSerializeCacheValue(cachedOp.values[j], op[j])) return false;
    }
  }
  return true;
}

function readSmallSerializeCacheValue(value: unknown): unknown {
  if (value === null) return value;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (Array.isArray(value)) {
    if (value.length > 8) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
    const values = new Array<unknown>(value.length);
    for (let i = 0, length = value.length; i < length; i++) {
      const item = value[i];
      const itemType = typeof item;
      if (item !== null && itemType !== 'string' && itemType !== 'number' && itemType !== 'boolean') {
        return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
      }
      values[i] = item;
    }
    return {
      kind: SERIALIZE_CACHE_ARRAY,
      ref: value,
      length: value.length,
      values
    };
  }

  if (type !== 'object') return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
  const keys = Object.keys(value as object);
  const keyCount = keys.length;
  if (keyCount === 0 || keyCount > SERIALIZE_CACHE_MAX_KEYS) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
  const values = new Array<unknown>(keyCount);
  for (let i = 0; i < keyCount; i++) {
    const cached = readSmallSerializeCacheValue((value as Record<string, unknown>)[keys[i]]);
    if (cached === UNSUPPORTED_SERIALIZE_CACHE_VALUE) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
    values[i] = cached;
  }
  return {
    kind: SERIALIZE_CACHE_OBJECT,
    ref: value,
    keys,
    values
  };
}

function isValidSmallSerializeCacheValue(cached, current: unknown): boolean {
  if (isSerializeArrayCacheValue(cached)) {
    if (current !== cached.ref || cached.ref.length !== cached.length) return false;
    for (let i = 0, length = cached.length; i < length; i++) {
      if (!Object.is(cached.ref[i], cached.values[i])) return false;
    }
    return true;
  }

  if (isSerializeObjectCacheValue(cached)) {
    if (current !== cached.ref || current === null || typeof current !== 'object' || Array.isArray(current)) return false;
    let index = 0;
    for (const key in current as object) {
      if (!hasOwn.call(current, key)) continue;
      if (key !== cached.keys[index]) return false;
      if (!isValidSmallSerializeCacheValue(cached.values[index], (current as Record<string, unknown>)[key])) return false;
      index++;
    }
    return index === cached.keys.length;
  }

  return Object.is(current, cached);
}

function isPrimitiveSegmentArray(values: unknown[]): boolean {
  for (let i = 0, length = values.length; i < length; i++) {
    const type = typeof values[i];
    if (type !== 'string' && type !== 'number') return false;
  }
  return true;
}

function isPrimitiveValueArray(values: unknown[]): boolean {
  for (let i = 0, length = values.length; i < length; i++) {
    if (!isPrimitiveJsonScalar(values[i])) return false;
  }
  return true;
}

function isPrimitiveJsonScalar(value: unknown): boolean {
  const type = typeof value;
  return value === null || type === 'string' || type === 'number' || type === 'boolean';
}

function getRepeatedScalarArrayValue(values: unknown[]): unknown {
  if (values.length < 4) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
  const first = values[0];
  if (!isPrimitiveJsonScalar(first)) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
  for (let i = 1, length = values.length; i < length; i++) {
    if (!Object.is(values[i], first)) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
  }
  return first;
}

function matchesPrimitiveArray(current: unknown[], cached: unknown[]): boolean {
  if (current.length !== cached.length) return false;
  for (let i = 0, length = current.length; i < length; i++) {
    if (!Object.is(current[i], cached[i])) return false;
  }
  return true;
}

function isCacheablePrimitiveArray(value: unknown, maxLength: number): value is unknown[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maxLength &&
    isPrimitiveValueArray(value);
}

function markSerializedPatchNoCache(patch: Patch): null {
  if (patch !== null && (typeof patch === 'object' || typeof patch === 'function')) {
    serializedPatchNoCache.add(patch as object);
  }
  return null;
}

function createSerializedSinglePatchCacheEntry(patch: Patch, op: unknown[], path: unknown[], value: unknown) {
  if (!shouldCacheSinglePatchValue(value, 0)) return null;
  const cachedValue = readSerializeCacheValue(value, 0);
  if (cachedValue === UNSUPPORTED_SERIALIZE_CACHE_VALUE) return null;
  return {
    op,
    path,
    pathValues: path.slice(),
    value: cachedValue,
    text: jsonStringify(patch)
  };
}

function shouldCacheSinglePatchValue(value: unknown, depth: number): boolean {
  if (value === null) return false;
  const type = typeof value;
  if (type === 'string') return shouldCacheSerializedString(value as string);
  if (type === 'number' || type === 'boolean') return true;
  if (depth >= SERIALIZE_CACHE_MAX_DEPTH) return false;

  if (Array.isArray(value)) {
    const maxLength = depth === 0 ? SERIALIZE_CACHE_MAX_ROOT_ARRAY_LENGTH : SERIALIZE_CACHE_MAX_ARRAY_LENGTH;
    if (value.length > maxLength) return false;
    for (let i = 0, length = value.length; i < length; i++) {
      if (shouldCacheSinglePatchValue(value[i], depth + 1)) return true;
    }
    return false;
  }

  if (type !== 'object') return false;
  const keys = Object.keys(value as object);
  const keyCount = keys.length;
  if (keyCount === 0 || keyCount > SERIALIZE_CACHE_MAX_KEYS) return false;
  for (let i = 0; i < keyCount; i++) {
    if (shouldCacheSerializedString(keys[i]) || isSerializationSensitiveObjectKey(keys[i])) return true;
    if (shouldCacheSinglePatchValue((value as Record<string, unknown>)[keys[i]], depth + 1)) return true;
  }
  return false;
}

function isSerializationSensitiveObjectKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function shouldCacheSerializedString(value: string): boolean {
  if (value.length >= SERIALIZE_CACHE_STRING_MIN_LENGTH) return true;
  for (let i = 0, length = value.length; i < length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x22 || code === 0x5c || code > 0x7f) return true;
  }
  return false;
}

function readSerializeCacheValue(value: unknown, depth: number): unknown {
  if (value === null) return value;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (depth >= SERIALIZE_CACHE_MAX_DEPTH) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;

  if (Array.isArray(value)) {
    const maxLength = depth === 0 ? SERIALIZE_CACHE_MAX_ROOT_ARRAY_LENGTH : SERIALIZE_CACHE_MAX_ARRAY_LENGTH;
    if (value.length > maxLength) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
    const values = new Array<unknown>(value.length);
    for (let i = 0, length = value.length; i < length; i++) {
      const cached = readSerializeCacheValue(value[i], depth + 1);
      if (cached === UNSUPPORTED_SERIALIZE_CACHE_VALUE) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
      values[i] = cached;
    }
    return {
      kind: SERIALIZE_CACHE_ARRAY,
      ref: value,
      length: value.length,
      values
    };
  }

  if (typeof value !== 'object') return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
  const keys = Object.keys(value as object);
  const keyCount = keys.length;
  if (keyCount === 0 || keyCount > SERIALIZE_CACHE_MAX_KEYS) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
  const values = new Array<unknown>(keyCount);
  for (let i = 0; i < keyCount; i++) {
    const cached = readSerializeCacheValue((value as Record<string, unknown>)[keys[i]], depth + 1);
    if (cached === UNSUPPORTED_SERIALIZE_CACHE_VALUE) return UNSUPPORTED_SERIALIZE_CACHE_VALUE;
    values[i] = cached;
  }

  return {
    kind: SERIALIZE_CACHE_OBJECT,
    ref: value,
    keys,
    values
  };
}

function isValidSerializedSinglePatchCache(entry, op: unknown[], path: unknown[], value: unknown): boolean {
  if (entry.op !== op || entry.path !== path) return false;
  if (path.length !== entry.pathValues.length) return false;
  for (let i = 0, length = path.length; i < length; i++) {
    if (!Object.is(path[i], entry.pathValues[i])) return false;
  }
  return isValidSerializeCacheValue(entry.value, value);
}

function isValidSerializeCacheValue(cached, current: unknown): boolean {
  if (isSerializeArrayCacheValue(cached)) {
    if (current !== cached.ref || cached.ref.length !== cached.length) return false;
    for (let i = 0, length = cached.length; i < length; i++) {
      if (!isValidSerializeCacheValue(cached.values[i], cached.ref[i])) return false;
    }
    return true;
  }

  if (isSerializeObjectCacheValue(cached)) {
    if (current !== cached.ref || current === null || typeof current !== 'object' || Array.isArray(current)) return false;
    let index = 0;
    for (const key in current as object) {
      if (!hasOwn.call(current, key)) continue;
      if (key !== cached.keys[index]) return false;
      if (!isValidSerializeCacheValue(cached.values[index], (current as Record<string, unknown>)[key])) return false;
      index++;
    }
    return index === cached.keys.length;
  }

  return Object.is(current, cached);
}

function isSerializeArrayCacheValue(value): value is { kind: typeof SERIALIZE_CACHE_ARRAY; ref: unknown[]; length: number; values: unknown[] } {
  return value !== null && typeof value === 'object' && value.kind === SERIALIZE_CACHE_ARRAY;
}

function isSerializeObjectCacheValue(value): value is { kind: typeof SERIALIZE_CACHE_OBJECT; ref: object; keys: string[]; values: unknown[] } {
  return value !== null && typeof value === 'object' && value.kind === SERIALIZE_CACHE_OBJECT;
}

export function encodePatch(patch: Patch, options?: CodecOptions): Uint8Array {
  if (!options || options.validate !== false) {
    assertPatch(patch);
  }

  const rootStringSpliceCopy = getRootStringSpliceCopyPatch(patch);
  if (rootStringSpliceCopy !== null) {
    return encodeRootStringSpliceCopyPatch(rootStringSpliceCopy);
  }

  const rootStringSplice = getRootStringSpliceOperation(patch);
  if (rootStringSplice !== null) {
    if (hasUnpairedSurrogate(rootStringSplice[4])) {
      const writer = createPatchWriter();
      writer.writeByte(TAG_ROOT_STRING_SPLICE_PATCH);
      writer.writeVarint(rootStringSplice[2]);
      writer.writeVarint(rootStringSplice[3]);
      writer.writeRawString(rootStringSplice[4]);
      return writer.finish();
    }

    if (rootStringSplice[4].length >= 64) {
      return encodeRootStringSplicePatch(rootStringSplice);
    }

    const writer = createPatchWriter();
    writer.writeByte(TAG_ROOT_STRING_SPLICE_PATCH);
    writer.writeVarint(rootStringSplice[2]);
    writer.writeVarint(rootStringSplice[3]);
    writer.writeRawString(rootStringSplice[4]);
    return writer.finish();
  }

  const rootAppendIntRun = getRootAppendIntRunOperation(patch);
  if (rootAppendIntRun !== null) {
    return encodeRootAppendIntRunPatch(rootAppendIntRun);
  }

  const writer = createPatchWriter();
  const rootRemoveAssign = getRootRemoveAssignPatch(patch);
  if (rootRemoveAssign !== null) {
    writer.writeByte(TAG_ROOT_REMOVE_ASSIGN_PATCH);
    writeRootRemoveAssignPatch(writer, rootRemoveAssign);
    return writer.finish();
  }
  const assignObject = getAssignObjectPatch(patch);
  if (assignObject !== null) {
    if (assignObject[0].length === 0) {
      writer.writeByte(TAG_ROOT_ASSIGN_OBJECT_PATCH);
      writeAssignObjectPayload(writer, assignObject[1], assignObject[2], assignObject[3]);
    } else {
      writer.writeByte(TAG_ASSIGN_OBJECT_PATCH);
      writePath(writer, assignObject[0]);
      writeAssignObjectPayload(writer, assignObject[1], assignObject[2], assignObject[3]);
    }
    return writer.finish();
  }
  const smallStructural = getSmallStructuralPatch(patch);
  if (smallStructural !== null) {
    writer.writeByte(TAG_SMALL_STRUCTURAL_PATCH);
    writeSmallStructuralPatch(writer, smallStructural);
    return writer.finish();
  }
  const rootArrayObjectFieldValueChanged = getRootArrayObjectFieldValueChangedPatch(patch);
  if (rootArrayObjectFieldValueChanged !== null) {
    writer.writeByte(TAG_ROOT_ARRAY_OBJECT_FIELD_VALUE_CHANGED_PATCH);
    writeRootArrayObjectFieldValueChangedPatch(writer, rootArrayObjectFieldValueChanged);
    return writer.finish();
  }
  const rootArrayObjectValueChanged = getRootArrayObjectValueChangedPatch(patch);
  if (rootArrayObjectValueChanged !== null) {
    writer.writeByte(TAG_ROOT_ARRAY_OBJECT_VALUE_CHANGED_PATCH);
    writeRootArrayObjectValueChangedPatch(writer, rootArrayObjectValueChanged);
    return writer.finish();
  }
  const setPathShape = getSetPathShapePatch(patch);
  if (setPathShape !== null) {
    if (hasSetPathShapeSignedIntValues(patch)) {
      writer.writeByte(TAG_SET_PATH_SHAPE_SIGNED_INT_PATCH);
      writeSetPathShapeSignedIntPatch(writer, patch, setPathShape);
      return writer.finish();
    }
    writer.writeByte(TAG_SET_PATH_SHAPE_PATCH);
    writeSetPathShapePatch(writer, patch, setPathShape);
    return writer.finish();
  }
  if (writePatchOperations(writer, patch)) {
    return writer.finish();
  }
  writeBinaryValue(writer, patch);
  return writer.finish();
}

function createPatchWriter() {
  const writer = new BinaryWriter();
  writer.writeByte(BINARY_MAGIC_0);
  writer.writeByte(BINARY_MAGIC_1);
  writer.writeByte(BINARY_MAGIC_2);
  writer.writeByte(BINARY_VERSION);
  return writer;
}

function encodeRootStringSplicePatch(op) {
  const payload = textEncoder.encode(op[4]);
  const start = op[2];
  const deleteCount = op[3];
  const bytes = new Uint8Array(
    5 +
    varintByteLength(start) +
    varintByteLength(deleteCount) +
    varintByteLength(payload.length) +
    payload.length
  );

  bytes[0] = BINARY_MAGIC_0;
  bytes[1] = BINARY_MAGIC_1;
  bytes[2] = BINARY_MAGIC_2;
  bytes[3] = BINARY_VERSION;
  bytes[4] = TAG_ROOT_STRING_SPLICE_PATCH;
  let offset = writeVarintTo(bytes, 5, start);
  offset = writeVarintTo(bytes, offset, deleteCount);
  offset = writeVarintTo(bytes, offset, payload.length);
  bytes.set(payload, offset);
  return bytes;
}

function encodeRootStringSpliceCopyPatch(patchInfo) {
  const splice = patchInfo[0];
  const copy = patchInfo[1];
  const insert = splice[4];

  if (hasUnpairedSurrogate(insert)) {
    const writer = createPatchWriter();
    writer.writeByte(TAG_ROOT_STRING_SPLICE_COPY_PATCH);
    writer.writeVarint(splice[2]);
    writer.writeVarint(splice[3]);
    writer.writeRawString(insert);
    writer.writeVarint(copy[2]);
    writer.writeVarint(copy[3]);
    writer.writeVarint(copy[4]);
    return writer.finish();
  }

  let payload: Uint8Array | null = null;
  let payloadLength = insert.length;
  for (let i = 0; i < payloadLength; i++) {
    if (insert.charCodeAt(i) > 0x7f) {
      payload = textEncoder.encode(insert);
      payloadLength = payload.length;
      break;
    }
  }

  const bytes = new Uint8Array(
    5 +
    varintByteLength(splice[2]) +
    varintByteLength(splice[3]) +
    varintByteLength(payloadLength) +
    payloadLength +
    varintByteLength(copy[2]) +
    varintByteLength(copy[3]) +
    varintByteLength(copy[4])
  );

  bytes[0] = BINARY_MAGIC_0;
  bytes[1] = BINARY_MAGIC_1;
  bytes[2] = BINARY_MAGIC_2;
  bytes[3] = BINARY_VERSION;
  bytes[4] = TAG_ROOT_STRING_SPLICE_COPY_PATCH;
  let offset = writeVarintTo(bytes, 5, splice[2]);
  offset = writeVarintTo(bytes, offset, splice[3]);
  offset = writeVarintTo(bytes, offset, payloadLength);
  if (payload === null) {
    for (let i = 0; i < payloadLength; i++) bytes[offset++] = insert.charCodeAt(i);
  } else {
    bytes.set(payload, offset);
    offset += payloadLength;
  }
  offset = writeVarintTo(bytes, offset, copy[2]);
  offset = writeVarintTo(bytes, offset, copy[3]);
  writeVarintTo(bytes, offset, copy[4]);
  return bytes;
}

function encodeRootAppendIntRunPatch(patchInfo) {
  const bytes = new Uint8Array(25);
  bytes[0] = BINARY_MAGIC_0;
  bytes[1] = BINARY_MAGIC_1;
  bytes[2] = BINARY_MAGIC_2;
  bytes[3] = BINARY_VERSION;
  bytes[4] = TAG_ROOT_APPEND_INT_RUN_PATCH;
  let offset = writeVarintTo(bytes, 5, patchInfo[0]);
  offset = writeSignedVarintTo(bytes, offset, patchInfo[1]);
  return bytes.slice(0, offset);
}

function writeSignedVarintTo(bytes, offset, value) {
  return writeVarintTo(bytes, offset, value < 0 ? (-value * 2) - 1 : value * 2);
}

function writeVarintTo(bytes, offset, value) {
  while (value >= 0x80) {
    bytes[offset++] = (value % 0x80) | 0x80;
    value = Math.floor(value / 0x80);
  }
  bytes[offset++] = value;
  return offset;
}

export function decodePatch(bytes: ArrayBuffer | ArrayBufferView, options?: CodecOptions): Patch {
  const input = binaryBytes(bytes);
  if (
    input.length >= 5 &&
    input[0] === BINARY_MAGIC_0 &&
    input[1] === BINARY_MAGIC_1 &&
    input[2] === BINARY_MAGIC_2 &&
    input[3] === BINARY_VERSION
  ) {
    const tag = input[4];
    if (
      tag === TAG_ROOT_APPEND_INT_RUN_PATCH ||
      tag === TAG_ROOT_STRING_SPLICE_PATCH ||
      tag === TAG_ROOT_STRING_SPLICE_COPY_PATCH
    ) {
      const fastPatch = decodeCompactRootPatch(input, tag);
      if (fastPatch !== null) {
        if (!options || options.validate !== false) {
          assertPatch(fastPatch);
        }
        return fastPatch;
      }
    }
  }

  const reader = new BinaryReader(input);
  if (
    reader.readByte() !== BINARY_MAGIC_0 ||
    reader.readByte() !== BINARY_MAGIC_1 ||
    reader.readByte() !== BINARY_MAGIC_2 ||
    reader.readByte() !== BINARY_VERSION
  ) {
    throw new TypeError('invalid binary patch header');
  }

  const patch = readBinaryValue(reader);
  if (reader.offset !== reader.bytes.length) {
    throw new TypeError('unexpected trailing binary patch data');
  }
  if (!options || options.validate !== false) {
    assertPatch(patch);
  }
  return patch;
}

export function encodePatchBase64url(patch: Patch, options?: CodecOptions): string {
  return encodeBase64urlBytes(encodePatch(patch, options));
}

export function decodePatchBase64url(text: string, options?: CodecOptions): Patch {
  return decodePatch(decodeBase64urlBytes(text), options);
}

function binaryBytes(value: ArrayBuffer | ArrayBufferView) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('binary patch data must be an ArrayBuffer or typed array');
}

function encodeBase64urlBytes(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  const length = bytes.length;
  for (; i + 2 < length; i += 3) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64URL_ALPHABET[(value >>> 18) & 63];
    out += BASE64URL_ALPHABET[(value >>> 12) & 63];
    out += BASE64URL_ALPHABET[(value >>> 6) & 63];
    out += BASE64URL_ALPHABET[value & 63];
  }

  const remaining = length - i;
  if (remaining === 1) {
    const value = bytes[i] << 16;
    out += BASE64URL_ALPHABET[(value >>> 18) & 63];
    out += BASE64URL_ALPHABET[(value >>> 12) & 63];
  } else if (remaining === 2) {
    const value = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64URL_ALPHABET[(value >>> 18) & 63];
    out += BASE64URL_ALPHABET[(value >>> 12) & 63];
    out += BASE64URL_ALPHABET[(value >>> 6) & 63];
  }
  return out;
}

function decodeBase64urlBytes(text: string): Uint8Array {
  if (typeof text !== 'string') throw new TypeError('base64url patch must be a string');
  if (text.indexOf('=') !== -1) throw new TypeError('base64url patch must not use padding');
  if ((text.length & 3) === 1) throw new TypeError('invalid base64url patch length');

  const outputLength = Math.floor((text.length * 6) / 8);
  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let offset = 0;

  for (let i = 0, length = text.length; i < length; i++) {
    const code = text.charCodeAt(i);
    const value = code < BASE64URL_DECODE.length ? BASE64URL_DECODE[code] : -1;
    if (value < 0) throw new TypeError('invalid base64url patch character');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (buffer >>> bits) & 0xff;
    }
  }

  if (offset !== outputLength) throw new TypeError('invalid base64url patch data');
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new TypeError('invalid base64url trailing bits');
  }
  return bytes;
}

function makeBase64UrlDecodeTable(): Int16Array {
  const table = new Int16Array(128);
  for (let i = 0; i < table.length; i++) table[i] = -1;
  for (let i = 0; i < BASE64URL_ALPHABET.length; i++) {
    table[BASE64URL_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
}

function decodeCompactRootPatch(bytes, tag): Patch | null {
  if (tag === TAG_ROOT_STRING_SPLICE_COPY_PATCH) {
    return decodeCompactRootStringSpliceCopyPatch(bytes);
  }

  if (tag === TAG_ROOT_APPEND_INT_RUN_PATCH) {
    const lengthRead = readVarintAt(bytes, 5);
    const signedRead = readVarintAt(bytes, lengthRead[1]);
    if (!Number.isSafeInteger(lengthRead[0]) || !Number.isSafeInteger(signedRead[0]) || signedRead[1] !== bytes.length) {
      return null;
    }

    const length = lengthRead[0];
    let value = decodeSignedVarintValue(signedRead[0]);
    const values = new Array(length);
    for (let i = 0; i < length; i++, value++) {
      values[i] = value;
    }
    return [[OP_APPEND, [], values]] as Patch;
  }

  if (tag === TAG_ROOT_STRING_SPLICE_PATCH) {
    const startRead = readVarintAt(bytes, 5);
    const deleteRead = readVarintAt(bytes, startRead[1]);
    const insertRead = readRawStringAt(bytes, deleteRead[1]);
    if (
      !Number.isSafeInteger(startRead[0]) ||
      !Number.isSafeInteger(deleteRead[0]) ||
      insertRead === null ||
      insertRead[1] !== bytes.length
    ) {
      return null;
    }
    return [[
      OP_STRING_SPLICE,
      [],
      startRead[0],
      deleteRead[0],
      insertRead[0]
    ]] as Patch;
  }

  return null;
}

function decodeCompactRootStringSpliceCopyPatch(bytes): Patch | null {
  const start = readCompactVarintAt(bytes, 5);
  if (!Number.isSafeInteger(start)) return null;
  const deleteCount = readCompactVarintAt(bytes, compactReadOffset);
  if (!Number.isSafeInteger(deleteCount)) return null;
  const insert = readCompactRawStringAt(bytes, compactReadOffset);
  if (insert === null) return null;
  const copyTarget = readCompactVarintAt(bytes, compactReadOffset);
  if (!Number.isSafeInteger(copyTarget)) return null;
  const copySource = readCompactVarintAt(bytes, compactReadOffset);
  if (!Number.isSafeInteger(copySource)) return null;
  const copyLength = readCompactVarintAt(bytes, compactReadOffset);
  if (!Number.isSafeInteger(copyLength) || compactReadOffset !== bytes.length) return null;

  return [
    [OP_STRING_SPLICE, [], start, deleteCount, insert],
    [OP_STRING_COPY, [], copyTarget, copySource, copyLength]
  ] as Patch;
}

function readCompactVarintAt(bytes, offset) {
  let value = 0;
  let multiplier = 1;

  for (;;) {
    if (offset >= bytes.length) {
      compactReadOffset = offset;
      return NaN;
    }
    const byte = bytes[offset++];
    value += (byte & 0x7f) * multiplier;
    if (byte < 0x80) {
      compactReadOffset = offset;
      return value;
    }
    multiplier *= 0x80;
    if (multiplier > Number.MAX_SAFE_INTEGER) {
      compactReadOffset = offset;
      return NaN;
    }
  }
}

function readCompactRawStringAt(bytes, offset) {
  const length = readCompactVarintAt(bytes, offset);
  if (!Number.isSafeInteger(length)) return null;

  if (length === RAW_STRING_UTF16_SENTINEL) {
    const read = readUtf16StringAt(bytes, compactReadOffset);
    if (read === null) return null;
    compactReadOffset = read[1];
    return read[0];
  }

  const end = compactReadOffset + length;
  if (end > bytes.length) return null;
  if (length <= 64) {
    const ascii = decodeSmallAsciiStringAt(bytes, compactReadOffset, length);
    if (ascii !== null) {
      compactReadOffset = end;
      return ascii;
    }
  }
  const value = textDecoder.decode(bytes.subarray(compactReadOffset, end));
  compactReadOffset = end;
  return value;
}

function readVarintAt(bytes, offset) {
  let value = 0;
  let multiplier = 1;

  for (;;) {
    if (offset >= bytes.length) return [NaN, offset];
    const byte = bytes[offset++];
    value += (byte & 0x7f) * multiplier;
    if (byte < 0x80) return [value, offset];
    multiplier *= 0x80;
    if (multiplier > Number.MAX_SAFE_INTEGER) return [NaN, offset];
  }
}

function readRawStringAt(bytes, offset) {
  const lengthRead = readVarintAt(bytes, offset);
  const length = lengthRead[0];
  if (!Number.isSafeInteger(length)) return null;

  if (length === RAW_STRING_UTF16_SENTINEL) {
    return readUtf16StringAt(bytes, lengthRead[1]);
  }

  const end = lengthRead[1] + length;
  if (end > bytes.length) return null;
  if (length <= 64) {
    const ascii = decodeSmallAsciiStringAt(bytes, lengthRead[1], length);
    if (ascii !== null) return [ascii, end];
  }
  return [textDecoder.decode(bytes.subarray(lengthRead[1], end)), end];
}

function decodeSmallAsciiStringAt(bytes, offset, length) {
  const codes = SMALL_ASCII_CODES;
  codes.length = length;
  for (let i = 0; i < length; i++) {
    const byte = bytes[offset + i];
    if (byte > 0x7f) return null;
    codes[i] = byte;
  }
  return String.fromCharCode.apply(null, codes);
}

function readUtf16StringAt(bytes, offset) {
  const lengthRead = readVarintAt(bytes, offset);
  const length = lengthRead[0];
  if (!Number.isSafeInteger(length)) return null;
  const byteLength = length * 2;
  const end = lengthRead[1] + byteLength;
  if (end > bytes.length) return null;
  return [decodeUtf16String(bytes, lengthRead[1], length), end];
}

function decodeSignedVarintValue(value) {
  return value % 2 === 1 ? -((value + 1) / 2) : value / 2;
}

function writeBinaryValue(writer, value) {
  if (value === null) {
    writer.writeByte(TAG_NULL);
    return;
  }

  const type = typeof value;
  if (type === 'boolean') {
    writer.writeByte(value ? TAG_TRUE : TAG_FALSE);
    return;
  }

  if (type === 'number') {
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
      writer.writeByte(TAG_INT);
      writer.writeSignedVarint(value);
    } else {
      writer.writeByte(TAG_DOUBLE);
      writer.writeDouble(value);
    }
    return;
  }

  if (type === 'string') {
    writer.writeByte(TAG_STRING);
    writer.writeString(value);
    return;
  }

  if (Array.isArray(value)) {
    const repeatedScalar = getRepeatedScalarArrayValue(value);
    if (repeatedScalar !== UNSUPPORTED_SERIALIZE_CACHE_VALUE) {
      writer.writeByte(TAG_ARRAY_REPEAT_VALUE);
      writer.writeVarint(value.length);
      writeBinaryValue(writer, repeatedScalar);
      return;
    }

    if (value.length !== 0 && typeof value[0] === 'number') {
      const numericMode = readNumericArrayMode(value);
      if (numericMode === TAG_SIGNED_INT_ARRAY) {
        writer.writeByte(TAG_SIGNED_INT_ARRAY);
        writer.writeVarint(value.length);
        for (let i = 0, length = value.length; i < length; i++) writer.writeSignedVarint(value[i]);
        return;
      }
      if (numericMode === TAG_DOUBLE_ARRAY) {
        writer.writeByte(TAG_DOUBLE_ARRAY);
        writer.writeVarint(value.length);
        for (let i = 0, length = value.length; i < length; i++) writer.writeDouble(value[i]);
        return;
      }
    }

    if (isRepeatedRecordRows(value)) {
      writer.writeByte(TAG_COLUMNAR_RECORD_ARRAY);
      writeRepeatedRecordColumnarArray(writer, value);
      return;
    }

    const recordShape = recordArrayShape(value);
    if (recordShape !== null) {
      const recordModes = recordArrayModes(value, recordShape);
      if (recordModes !== null) {
        writer.writeByte(TAG_COLUMNAR_RECORD_ARRAY);
        writeColumnarRecordArray(writer, value, recordShape, recordModes);
        return;
      }

      writer.writeByte(TAG_RECORD_ARRAY);
      writer.writeVarint(value.length);
      writer.writeVarint(recordShape.length);
      for (let i = 0, length = recordShape.length; i < length; i++) {
        writer.writeString(recordShape[i]);
      }
      writeRecordArrayRows(writer, value, recordShape);
      return;
    }

    writer.writeByte(TAG_ARRAY);
    writer.writeVarint(value.length);
    for (let i = 0, length = value.length; i < length; i++) {
      writeBinaryValue(writer, value[i]);
    }
    return;
  }

  const keys = Object.keys(value);
  const shapeKey = keys.length >= 2 ? objectShapeKey(keys) : null;
  if (shapeKey !== null) {
    const shapeIndex = writer.shapes.get(shapeKey);
    if (shapeIndex !== undefined) {
      if (shapeIndex < 16) {
        writer.writeByte(TAG_OBJECT_SHAPE_BASE + shapeIndex);
      } else {
        writer.writeByte(TAG_OBJECT_SHAPE);
        writer.writeVarint(shapeIndex);
      }
      for (let i = 0, length = keys.length; i < length; i++) {
        writeBinaryValue(writer, value[keys[i]]);
      }
      return;
    }
  }

  writer.writeByte(TAG_OBJECT);
  writer.writeVarint(keys.length);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    writer.writeString(key);
    writeBinaryValue(writer, value[key]);
  }
  if (shapeKey !== null) {
    writer.shapes.set(shapeKey, writer.shapeCount++);
  }
}

function readNumericArrayMode(values): number {
  let allSignedInt = true;
  for (let i = 0, length = values.length; i < length; i++) {
    const value = values[i];
    if (typeof value !== 'number') return 0;
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) allSignedInt = false;
  }
  return allSignedInt ? TAG_SIGNED_INT_ARRAY : TAG_DOUBLE_ARRAY;
}

function readBinaryValue(reader) {
  const tag = reader.readByte();
  if (tag === TAG_NULL) return null;
  if (tag === TAG_FALSE) return false;
  if (tag === TAG_TRUE) return true;
  if (tag === TAG_INT) return reader.readSignedVarint();
  if (tag === TAG_DOUBLE) return reader.readDouble();
  if (tag === TAG_STRING) return reader.readString();

  if (tag === TAG_ROOT_STRING_SPLICE_PATCH) {
    return [[
      OP_STRING_SPLICE,
      [],
      reader.readVarint(),
      reader.readVarint(),
      reader.readRawString()
    ]];
  }

  if (tag === TAG_ROOT_STRING_SPLICE_COPY_PATCH) {
    const start = reader.readVarint();
    const deleteCount = reader.readVarint();
    const insert = reader.readRawString();
    return [
      [OP_STRING_SPLICE, [], start, deleteCount, insert],
      [OP_STRING_COPY, [], reader.readVarint(), reader.readVarint(), reader.readVarint()]
    ];
  }

  if (tag === TAG_PATCH_OPS) {
    return readPatchOperations(reader);
  }

  if (tag === TAG_ROOT_APPEND_INT_RUN_PATCH) {
    const length = reader.readVarint();
    let value = reader.readSignedVarint();
    const values = new Array(length);
    for (let i = 0; i < length; i++, value++) {
      values[i] = value;
    }
    return [[OP_APPEND, [], values]];
  }

  if (tag === TAG_SET_PATH_SHAPE_PATCH) {
    return readSetPathShapePatch(reader);
  }
  if (tag === TAG_SET_PATH_SHAPE_SIGNED_INT_PATCH) {
    return readSetPathShapeSignedIntPatch(reader);
  }

  if (tag === TAG_ROOT_ARRAY_OBJECT_VALUE_CHANGED_PATCH) {
    return readRootArrayObjectValueChangedPatch(reader);
  }

  if (tag === TAG_ROOT_ARRAY_OBJECT_FIELD_VALUE_CHANGED_PATCH) {
    return readRootArrayObjectFieldValueChangedPatch(reader);
  }

  if (tag === TAG_SMALL_STRUCTURAL_PATCH) {
    return readSmallStructuralPatch(reader);
  }

  if (tag === TAG_ROOT_REMOVE_ASSIGN_PATCH) {
    return readRootRemoveAssignPatch(reader);
  }

  if (tag === TAG_ASSIGN_OBJECT_PATCH) {
    return [[OP_ASSIGN, readPath(reader), readAssignObjectPayload(reader)]];
  }

  if (tag === TAG_ROOT_ASSIGN_OBJECT_PATCH) {
    return [[OP_ASSIGN, [], readAssignObjectPayload(reader)]];
  }

  if (tag === TAG_ARRAY_REPEAT_VALUE) {
    const length = reader.readVarint();
    const value = readBinaryValue(reader);
    const array = new Array(length);
    array.fill(value);
    return array;
  }

  if (tag === TAG_SIGNED_INT_ARRAY) {
    const length = reader.readVarint();
    const array = new Array(length);
    for (let i = 0; i < length; i++) array[i] = reader.readSignedVarint();
    return array;
  }

  if (tag === TAG_DOUBLE_ARRAY) {
    const length = reader.readVarint();
    const array = new Array(length);
    for (let i = 0; i < length; i++) array[i] = reader.readDouble();
    return array;
  }

  if (tag === TAG_ARRAY) {
    const length = reader.readVarint();
    const array = new Array(length);
    for (let i = 0; i < length; i++) {
      array[i] = readBinaryValue(reader);
    }
    return array;
  }

  if (tag === TAG_RECORD_ARRAY) {
    const length = reader.readVarint();
    const keyCount = reader.readVarint();
    const shape = new Array(keyCount);
    for (let i = 0; i < keyCount; i++) {
      shape[i] = reader.readString();
    }

    return readRecordArrayRows(reader, length, shape);
  }

  if (tag === TAG_COLUMNAR_RECORD_ARRAY) {
    return readColumnarRecordArray(reader);
  }

  if (tag === TAG_OBJECT) {
    const length = reader.readVarint();
    const object = {};
    const shape = length >= 2 ? new Array(length) : null;
    for (let i = 0; i < length; i++) {
      const key = reader.readString();
      if (shape !== null) shape[i] = key;
      setDecodedValue(object, key, readBinaryValue(reader));
    }
    if (shape !== null) reader.shapes[reader.shapes.length] = shape;
    return object;
  }

  if (tag === TAG_OBJECT_SHAPE) {
    const shape = reader.shapes[reader.readVarint()];
    if (shape === undefined) throw new TypeError('invalid binary patch object shape reference');
    const object = {};
    for (let i = 0, length = shape.length; i < length; i++) {
      setDecodedValue(object, shape[i], readBinaryValue(reader));
    }
    return object;
  }

  if (tag >= TAG_OBJECT_SHAPE_BASE && tag < TAG_OBJECT_SHAPE_LIMIT) {
    const shape = reader.shapes[tag - TAG_OBJECT_SHAPE_BASE];
    if (shape === undefined) throw new TypeError('invalid binary patch object shape reference');
    const object = {};
    for (let i = 0, length = shape.length; i < length; i++) {
      setDecodedValue(object, shape[i], readBinaryValue(reader));
    }
    return object;
  }

  throw new TypeError('unknown binary patch tag: ' + tag);
}

function writePatchOperations(writer, patch) {
  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i];
    if (!Array.isArray(op) || !Array.isArray(op[1])) return false;
    const code = op[0];
    if (
      code !== OP_SET &&
      code !== OP_REMOVE &&
      code !== OP_TRUNCATE &&
      code !== OP_APPEND &&
      code !== OP_ASSIGN &&
      code !== OP_STRING_SPLICE &&
      code !== OP_ARRAY_SPLICE &&
      code !== OP_ARRAY_MOVE &&
      code !== OP_STRING_COPY &&
      code !== OP_ARRAY_ASSIGN &&
      code !== OP_ARRAY_OBJECT_ASSIGN &&
      code !== OP_ARRAY_TUPLE_ASSIGN &&
      code !== OP_ARRAY_OBJECT_FIELD_ASSIGN &&
      code !== OP_SCALAR_ARRAY_REPLACE &&
      code !== OP_ARRAY_TWO_FIELD_INSERT
    ) {
      return false;
    }
  }

  writer.writeByte(TAG_PATCH_OPS);
  writer.writeVarint(patch.length);
  for (let i = 0, length = patch.length; i < length; i++) {
    const op = patch[i];
    const code = op[0];
    writer.writeByte(code);
    writePath(writer, op[1]);
    if (code === OP_SET || code === OP_APPEND || code === OP_ASSIGN || code === OP_SCALAR_ARRAY_REPLACE) {
      writeBinaryValue(writer, op[2]);
    } else if (code === OP_TRUNCATE) {
      writer.writeVarint(op[2]);
    } else if (code === OP_STRING_SPLICE) {
      writer.writeVarint(op[2]);
      writer.writeVarint(op[3]);
      writer.writeRawString(op[4]);
    } else if (code === OP_ARRAY_SPLICE) {
      writer.writeVarint(op[2]);
      writer.writeVarint(op[3]);
      writeBinaryValue(writer, op[4]);
    } else if (code === OP_ARRAY_TWO_FIELD_INSERT) {
      writer.writeVarint(op[2]);
      writer.writeRawString(op[3]);
      writer.writeRawString(op[4]);
      writeBinaryValue(writer, op[5]);
      writeBinaryValue(writer, op[6]);
    } else if (code === OP_ARRAY_MOVE) {
      writer.writeVarint(op[2]);
      writer.writeVarint(op[3]);
    } else if (code === OP_STRING_COPY) {
      writer.writeVarint(op[2]);
      writer.writeVarint(op[3]);
      writer.writeVarint(op[4]);
    } else if (code === OP_ARRAY_ASSIGN || code === OP_ARRAY_OBJECT_ASSIGN) {
      writeIndexList(writer, op[2]);
      writeBinaryValue(writer, op[3]);
    } else if (code === OP_ARRAY_TUPLE_ASSIGN) {
      writeIndexList(writer, op[2]);
      writeIndexList(writer, op[3]);
      writeBinaryValue(writer, op[4]);
    } else if (code === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
      writeIndexList(writer, op[2]);
      writeBinaryValue(writer, op[3]);
      writeBinaryValue(writer, op[4]);
    }
  }
  return true;
}

function readPatchOperations(reader) {
  const length = reader.readVarint();
  const patch = new Array(length);

  for (let i = 0; i < length; i++) {
    const code = reader.readByte();
    const path = readPath(reader);
    if (code === OP_SET) {
      patch[i] = [OP_SET, path, readBinaryValue(reader)];
    } else if (code === OP_REMOVE) {
      patch[i] = [OP_REMOVE, path];
    } else if (code === OP_TRUNCATE) {
      patch[i] = [OP_TRUNCATE, path, reader.readVarint()];
    } else if (code === OP_APPEND) {
      patch[i] = [OP_APPEND, path, readBinaryValue(reader)];
    } else if (code === OP_SCALAR_ARRAY_REPLACE) {
      patch[i] = [OP_SCALAR_ARRAY_REPLACE, path, readBinaryValue(reader)];
    } else if (code === OP_ASSIGN) {
      patch[i] = [OP_ASSIGN, path, readBinaryValue(reader)];
    } else if (code === OP_STRING_SPLICE) {
      patch[i] = [
        OP_STRING_SPLICE,
        path,
        reader.readVarint(),
        reader.readVarint(),
        reader.readRawString()
      ];
    } else if (code === OP_ARRAY_SPLICE) {
      patch[i] = [
        OP_ARRAY_SPLICE,
        path,
        reader.readVarint(),
        reader.readVarint(),
        readBinaryValue(reader)
      ];
    } else if (code === OP_ARRAY_TWO_FIELD_INSERT) {
      patch[i] = [
        OP_ARRAY_TWO_FIELD_INSERT,
        path,
        reader.readVarint(),
        reader.readRawString(),
        reader.readRawString(),
        readBinaryValue(reader),
        readBinaryValue(reader)
      ];
    } else if (code === OP_ARRAY_MOVE) {
      patch[i] = [OP_ARRAY_MOVE, path, reader.readVarint(), reader.readVarint()];
    } else if (code === OP_STRING_COPY) {
      patch[i] = [
        OP_STRING_COPY,
        path,
        reader.readVarint(),
        reader.readVarint(),
        reader.readVarint()
      ];
    } else if (code === OP_ARRAY_ASSIGN) {
      patch[i] = [OP_ARRAY_ASSIGN, path, readIndexList(reader), readBinaryValue(reader)];
    } else if (code === OP_ARRAY_OBJECT_ASSIGN) {
      patch[i] = [OP_ARRAY_OBJECT_ASSIGN, path, readIndexList(reader), readBinaryValue(reader)];
    } else if (code === OP_ARRAY_TUPLE_ASSIGN) {
      patch[i] = [
        OP_ARRAY_TUPLE_ASSIGN,
        path,
        readIndexList(reader),
        readIndexList(reader),
        readBinaryValue(reader)
      ];
    } else if (code === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
      patch[i] = [
        OP_ARRAY_OBJECT_FIELD_ASSIGN,
        path,
        readIndexList(reader),
        readBinaryValue(reader),
        readBinaryValue(reader)
      ];
    } else {
      throw new TypeError('unknown patch opcode: ' + code);
    }
  }

  return patch;
}

function writeIndexList(writer, indexes) {
  const length = indexes.length;
  if (length === 0) {
    writer.writeByte(INDEX_LIST_RAW);
    writer.writeVarint(0);
    return;
  }

  let isRun = true;
  let isDelta = true;
  let isArithmetic = length > 2;
  let previous = indexes[0];
  const step = length > 1 ? indexes[1] - indexes[0] : 0;
  for (let i = 1; i < length; i++) {
    const value = indexes[i];
    if (value !== previous + 1) isRun = false;
    if (value < previous) isDelta = false;
    if (i > 1 && value - previous !== step) isArithmetic = false;
    previous = value;
  }

  if (isRun && length > 1) {
    writer.writeByte(INDEX_LIST_RUN);
    writer.writeVarint(length);
    writer.writeVarint(indexes[0]);
    return;
  }

  if (isDelta && isArithmetic && step > 1) {
    writer.writeByte(INDEX_LIST_ARITHMETIC);
    writer.writeVarint(length);
    writer.writeVarint(indexes[0]);
    writer.writeVarint(step);
    return;
  }

  if (isDelta && length > 2) {
    const deltaSize = indexListDeltaByteLength(indexes);
    const chunkedPlan = length >= INDEX_CHUNKED_MIN_LENGTH ? buildChunkedIndexListPlan(indexes) : null;
    const chunkedSize = chunkedPlan === null ? Number.MAX_SAFE_INTEGER : chunkedPlan.size;
    if (chunkedPlan !== null && chunkedSize < deltaSize) {
      writeChunkedIndexList(writer, indexes, chunkedPlan.chunks);
      return;
    }
    const eliasFanoSize = indexListEliasFanoByteLength(indexes);
    if (
      chunkedPlan === null &&
      eliasFanoSize + INDEX_ELIAS_FANO_MIN_SAVED_BYTES < deltaSize &&
      eliasFanoSize < chunkedSize
    ) {
      writeEliasFanoIndexList(writer, indexes);
      return;
    }

    writer.writeByte(INDEX_LIST_DELTA);
    writer.writeVarint(length);
    writer.writeVarint(indexes[0]);
    previous = indexes[0];
    for (let i = 1; i < length; i++) {
      const value = indexes[i];
      writer.writeVarint(value - previous);
      previous = value;
    }
    return;
  }

  writer.writeByte(INDEX_LIST_RAW);
  writer.writeVarint(length);
  for (let i = 0; i < length; i++) {
    writer.writeVarint(indexes[i]);
  }
}

function buildChunkedIndexListPlan(indexes) {
  const chunks = [];
  let pendingStart = 0;
  let index = 0;

  while (index < indexes.length) {
    let runLength = 1;
    while (
      index + runLength < indexes.length &&
      indexes[index + runLength] === indexes[index] + runLength
    ) {
      runLength++;
    }

    if (runLength >= INDEX_RUN_MIN_LENGTH) {
      if (pendingStart < index) {
        chunks[chunks.length] = [INDEX_LIST_DELTA, pendingStart, index];
      }
      chunks[chunks.length] = [INDEX_LIST_RUN, index, index + runLength];
      index += runLength;
      pendingStart = index;
    } else {
      index++;
    }
  }

  if (pendingStart < indexes.length) {
    chunks[chunks.length] = [INDEX_LIST_DELTA, pendingStart, indexes.length];
  }
  if (chunks.length <= 1) return null;

  let size = 1 + varintByteLength(indexes.length) + varintByteLength(chunks.length);
  for (let i = 0, length = chunks.length; i < length; i++) {
    const chunk = chunks[i];
    if (chunk[0] === INDEX_LIST_RUN) {
      size += 1 +
        varintByteLength(chunk[2] - chunk[1]) +
        varintByteLength(indexes[chunk[1]]);
    } else {
      size += 1 + indexListDeltaRangeByteLength(indexes, chunk[1], chunk[2]);
    }
  }
  return { chunks, size };
}

function writeChunkedIndexList(writer, indexes, chunks) {
  writer.writeByte(INDEX_LIST_CHUNKED);
  writer.writeVarint(indexes.length);
  writer.writeVarint(chunks.length);
  for (let i = 0, length = chunks.length; i < length; i++) {
    const chunk = chunks[i];
    const chunkLength = chunk[2] - chunk[1];
    writer.writeByte(chunk[0]);
    writer.writeVarint(chunkLength);
    if (chunk[0] === INDEX_LIST_RUN) {
      writer.writeVarint(indexes[chunk[1]]);
    } else {
      writeDeltaIndexRange(writer, indexes, chunk[1], chunk[2]);
    }
  }
}

function indexListDeltaByteLength(indexes) {
  return 1 + indexListDeltaRangeByteLength(indexes, 0, indexes.length);
}

function indexListEliasFanoByteLength(indexes) {
  const length = indexes.length;
  if (length < INDEX_ELIAS_FANO_MIN_LENGTH) return Number.MAX_SAFE_INTEGER;

  const base = indexes[0];
  const last = indexes[length - 1];
  if (!Number.isSafeInteger(base) || !Number.isSafeInteger(last) || base < 0 || last < base) {
    return Number.MAX_SAFE_INTEGER;
  }

  const universe = last - base + 1;
  const lowerBits = indexListEliasFanoLowerBits(universe, length);
  if (lowerBits > INDEX_ELIAS_FANO_MAX_LOWER_BITS) return Number.MAX_SAFE_INTEGER;

  const highBucketCount = Math.floor(universe / Math.pow(2, lowerBits));
  const highBitLength = length + highBucketCount + 1;
  const lowerBytes = Math.ceil(length * lowerBits / 8);
  const highBytes = Math.ceil(highBitLength / 8);
  return 1 +
    varintByteLength(length) +
    varintByteLength(base) +
    varintByteLength(universe) +
    lowerBytes +
    highBytes;
}

function indexListEliasFanoLowerBits(universe, length) {
  if (universe <= length) return 0;
  let ratio = Math.floor(universe / length);
  let bits = 0;
  while (ratio > 1) {
    ratio = Math.floor(ratio / 2);
    bits++;
  }
  return bits;
}

function writeEliasFanoIndexList(writer, indexes) {
  const length = indexes.length;
  const base = indexes[0];
  const universe = indexes[length - 1] - base + 1;
  const lowerBits = indexListEliasFanoLowerBits(universe, length);
  const lowBase = Math.pow(2, lowerBits);
  const highBucketCount = Math.floor(universe / lowBase);
  const highBitLength = length + highBucketCount + 1;

  writer.writeByte(INDEX_LIST_ELIAS_FANO);
  writer.writeVarint(length);
  writer.writeVarint(base);
  writer.writeVarint(universe);
  writeEliasFanoLowBits(writer, indexes, base, lowerBits, lowBase);
  writeEliasFanoHighBits(writer, indexes, base, lowerBits, lowBase, highBitLength);
}

function writeEliasFanoLowBits(writer, indexes, base, lowerBits, lowBase) {
  if (lowerBits === 0) return;
  const byteLength = Math.ceil(indexes.length * lowerBits / 8);
  writer.ensure(byteLength);
  const start = writer.offset;
  writer.bytes.fill(0, start, start + byteLength);

  let bitOffset = 0;
  for (let i = 0, length = indexes.length; i < length; i++) {
    let value = (indexes[i] - base) % lowBase;
    let remaining = lowerBits;
    while (remaining > 0) {
      const byteIndex = start + (bitOffset >> 3);
      const shift = bitOffset & 7;
      const take = Math.min(8 - shift, remaining);
      const mask = (1 << take) - 1;
      writer.bytes[byteIndex] |= (value & mask) << shift;
      value = Math.floor(value / (1 << take));
      bitOffset += take;
      remaining -= take;
    }
  }
  writer.offset += byteLength;
}

function writeEliasFanoHighBits(writer, indexes, base, lowerBits, lowBase, highBitLength) {
  const byteLength = Math.ceil(highBitLength / 8);
  writer.ensure(byteLength);
  const start = writer.offset;
  writer.bytes.fill(0, start, start + byteLength);

  for (let i = 0, length = indexes.length; i < length; i++) {
    const high = Math.floor((indexes[i] - base) / lowBase);
    const bit = high + i;
    writer.bytes[start + (bit >> 3)] |= 1 << (bit & 7);
  }
  writer.offset += byteLength;
}

function indexListDeltaRangeByteLength(indexes, start, end) {
  let size = varintByteLength(end - start);
  if (start >= end) return size;

  let previous = indexes[start];
  size += varintByteLength(previous);
  for (let i = start + 1; i < end; i++) {
    const value = indexes[i];
    size += varintByteLength(value - previous);
    previous = value;
  }
  return size;
}

function writeDeltaIndexRange(writer, indexes, start, end) {
  let previous = indexes[start];
  writer.writeVarint(previous);
  for (let i = start + 1; i < end; i++) {
    const value = indexes[i];
    writer.writeVarint(value - previous);
    previous = value;
  }
}

function varintByteLength(value) {
  let length = 1;
  while (value >= 0x80) {
    value = Math.floor(value / 0x80);
    length++;
  }
  return length;
}

function readIndexList(reader) {
  const mode = reader.readByte();
  const length = reader.readVarint();
  const indexes = new Array(length);

  if (mode === INDEX_LIST_RAW) {
    for (let i = 0; i < length; i++) {
      indexes[i] = reader.readVarint();
    }
    return indexes;
  }

  if (mode === INDEX_LIST_DELTA) {
    if (length === 0) return indexes;
    let value = reader.readVarint();
    indexes[0] = value;
    for (let i = 1; i < length; i++) {
      value += reader.readVarint();
      indexes[i] = value;
    }
    return indexes;
  }

  if (mode === INDEX_LIST_RUN) {
    const start = reader.readVarint();
    for (let i = 0; i < length; i++) {
      indexes[i] = start + i;
    }
    return indexes;
  }

  if (mode === INDEX_LIST_CHUNKED) {
    const chunkCount = reader.readVarint();
    let offset = 0;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
      const chunkMode = reader.readByte();
      const chunkLength = reader.readVarint();
      if (offset + chunkLength > length) {
        throw new TypeError('invalid binary patch index chunk length');
      }

      if (chunkMode === INDEX_LIST_RUN) {
        const start = reader.readVarint();
        for (let i = 0; i < chunkLength; i++) {
          indexes[offset++] = start + i;
        }
      } else if (chunkMode === INDEX_LIST_DELTA) {
        if (chunkLength > 0) {
          let value = reader.readVarint();
          indexes[offset++] = value;
          for (let i = 1; i < chunkLength; i++) {
            value += reader.readVarint();
            indexes[offset++] = value;
          }
        }
      } else {
        throw new TypeError('invalid binary patch index chunk mode');
      }
    }
    if (offset !== length) throw new TypeError('invalid binary patch index chunk length');
    return indexes;
  }

  if (mode === INDEX_LIST_ARITHMETIC) {
    const start = reader.readVarint();
    const step = reader.readVarint();
    if (
      length <= 2 ||
      step <= 1 ||
      start + (length - 1) * step > Number.MAX_SAFE_INTEGER
    ) {
      throw new TypeError('invalid binary patch arithmetic index list');
    }
    for (let i = 0; i < length; i++) {
      indexes[i] = start + i * step;
    }
    return indexes;
  }

  if (mode === INDEX_LIST_ELIAS_FANO) {
    const base = reader.readVarint();
    const universe = reader.readVarint();
    if (
      length < INDEX_ELIAS_FANO_MIN_LENGTH ||
      universe <= 0 ||
      base + universe - 1 > Number.MAX_SAFE_INTEGER
    ) {
      throw new TypeError('invalid binary patch Elias-Fano index list');
    }

    const lowerBits = indexListEliasFanoLowerBits(universe, length);
    if (lowerBits > INDEX_ELIAS_FANO_MAX_LOWER_BITS) {
      throw new TypeError('invalid binary patch Elias-Fano index list');
    }
    const lowBase = Math.pow(2, lowerBits);
    const highBucketCount = Math.floor(universe / lowBase);
    const highBitLength = length + highBucketCount + 1;
    const lowerBytes = Math.ceil(length * lowerBits / 8);
    const highBytes = Math.ceil(highBitLength / 8);
    const lowerOffset = reader.offset;
    const highOffset = lowerOffset + lowerBytes;
    const end = highOffset + highBytes;
    if (end > reader.bytes.length) throw new TypeError('unexpected end of binary patch data');
    reader.offset = end;

    let bit = 0;
    let previous = -1;
    for (let i = 0; i < length; i++) {
      bit = findNextSetBit(reader.bytes, highOffset, highBitLength, bit);
      if (bit < 0) throw new TypeError('invalid binary patch Elias-Fano index list');
      const high = bit - i;
      const low = readPackedFixedBits(reader.bytes, lowerOffset, i * lowerBits, lowerBits);
      const offset = high * lowBase + low;
      const value = base + offset;
      if (high < 0 || offset >= universe || value < previous) {
        throw new TypeError('invalid binary patch Elias-Fano index list');
      }
      indexes[i] = value;
      previous = value;
      bit++;
    }
    return indexes;
  }

  throw new TypeError('invalid binary patch index list mode');
}

function findNextSetBit(bytes, start, bitLength, bit) {
  while (bit < bitLength) {
    if ((bytes[start + (bit >> 3)] & (1 << (bit & 7))) !== 0) return bit;
    bit++;
  }
  return -1;
}

function readPackedFixedBits(bytes, start, bitOffset, bits) {
  let value = 0;
  let multiplier = 1;
  let remaining = bits;
  while (remaining > 0) {
    const byteIndex = start + (bitOffset >> 3);
    const shift = bitOffset & 7;
    const take = Math.min(8 - shift, remaining);
    const mask = (1 << take) - 1;
    value += ((bytes[byteIndex] >> shift) & mask) * multiplier;
    multiplier *= 1 << take;
    bitOffset += take;
    remaining -= take;
  }
  return value;
}

function writePath(writer, path) {
  writer.writeVarint(path.length);
  for (let i = 0, length = path.length; i < length; i++) {
    const segment = path[i];
    if (typeof segment === 'number') {
      writer.writeByte(PATH_SEGMENT_INT);
      writer.writeVarint(segment);
    } else {
      writer.writeByte(PATH_SEGMENT_STRING);
      writer.writeString(segment);
    }
  }
}

function readPath(reader) {
  const length = reader.readVarint();
  const path = new Array(length);
  for (let i = 0; i < length; i++) {
    const tag = reader.readByte();
    if (tag === PATH_SEGMENT_INT) {
      path[i] = reader.readVarint();
    } else if (tag === PATH_SEGMENT_STRING) {
      path[i] = reader.readString();
    } else {
      throw new TypeError('invalid binary patch path segment tag');
    }
  }
  return path;
}

function getSetPathShapePatch(patch) {
  const count = patch.length;
  if (count < 16) return null;

  const first = patch[0];
  if (!Array.isArray(first) || first[0] !== OP_SET || !Array.isArray(first[1])) return null;
  const pathLength = first[1].length;
  if (pathLength === 0) return null;

  const modes = new Array(pathLength);
  const constants = new Array(pathLength);
  for (let i = 0; i < pathLength; i++) {
    const segment = first[1][i];
    const type = typeof segment;
    if (type === 'number') {
      modes[i] = PATH_SHAPE_CONST_INT;
    } else if (type === 'string') {
      modes[i] = PATH_SHAPE_CONST_STRING;
    } else {
      return null;
    }
    constants[i] = segment;
  }

  for (let i = 1; i < count; i++) {
    const op = patch[i];
    if (!Array.isArray(op) || op[0] !== OP_SET || op.length !== 3 || !Array.isArray(op[1])) return null;
    const path = op[1];
    if (path.length !== pathLength) return null;

    for (let j = 0; j < pathLength; j++) {
      const segment = path[j];
      const mode = modes[j];
      if (mode === PATH_SHAPE_CONST_INT) {
        if (typeof segment !== 'number') return null;
        if (segment !== constants[j]) modes[j] = PATH_SHAPE_VAR_INT;
      } else if (mode === PATH_SHAPE_CONST_STRING) {
        if (typeof segment !== 'string') return null;
        if (segment !== constants[j]) modes[j] = PATH_SHAPE_VAR_STRING;
      } else if (mode === PATH_SHAPE_VAR_INT) {
        if (typeof segment !== 'number') return null;
      } else if (mode === PATH_SHAPE_VAR_STRING) {
        if (typeof segment !== 'string') return null;
      }
    }
  }

  let constantCount = 0;
  for (let i = 0; i < pathLength; i++) {
    if (modes[i] === PATH_SHAPE_CONST_INT || modes[i] === PATH_SHAPE_CONST_STRING) constantCount++;
  }
  return constantCount === 0 ? null : [pathLength, modes, constants];
}

function writeSetPathShapePatch(writer, patch, shape) {
  const pathLength = shape[0];
  const modes = shape[1];
  const constants = shape[2];

  writer.writeVarint(patch.length);
  writer.writeVarint(pathLength);
  for (let i = 0; i < pathLength; i++) {
    const mode = modes[i];
    writer.writeByte(mode);
    if (mode === PATH_SHAPE_CONST_INT) {
      writer.writeVarint(constants[i]);
    } else if (mode === PATH_SHAPE_CONST_STRING) {
      writer.writeString(constants[i]);
    }
  }

  for (let i = 0, length = patch.length; i < length; i++) {
    const path = patch[i][1];
    for (let j = 0; j < pathLength; j++) {
      const mode = modes[j];
      if (mode === PATH_SHAPE_VAR_INT) {
        writer.writeVarint(path[j]);
      } else if (mode === PATH_SHAPE_VAR_STRING) {
        writer.writeString(path[j]);
      }
    }
    writeBinaryValue(writer, patch[i][2]);
  }
}

function hasSetPathShapeSignedIntValues(patch) {
  for (let i = 0, length = patch.length; i < length; i++) {
    const value = patch[i][2];
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) return false;
  }
  return true;
}

function writeSetPathShapeHeader(writer, count, pathLength, modes, constants) {
  writer.writeVarint(count);
  writer.writeVarint(pathLength);
  for (let i = 0; i < pathLength; i++) {
    const mode = modes[i];
    writer.writeByte(mode);
    if (mode === PATH_SHAPE_CONST_INT) {
      writer.writeVarint(constants[i]);
    } else if (mode === PATH_SHAPE_CONST_STRING) {
      writer.writeString(constants[i]);
    }
  }
}

function writeSetPathShapeSignedIntPatch(writer, patch, shape) {
  const pathLength = shape[0];
  const modes = shape[1];
  const constants = shape[2];

  writeSetPathShapeHeader(writer, patch.length, pathLength, modes, constants);

  for (let i = 0, length = patch.length; i < length; i++) {
    const path = patch[i][1];
    for (let j = 0; j < pathLength; j++) {
      const mode = modes[j];
      if (mode === PATH_SHAPE_VAR_INT) {
        writer.writeVarint(path[j]);
      } else if (mode === PATH_SHAPE_VAR_STRING) {
        writer.writeString(path[j]);
      }
    }
    writer.writeSignedVarint(patch[i][2]);
  }
}

function readSetPathShapePatch(reader) {
  const count = reader.readVarint();
  const pathLength = reader.readVarint();
  const modes = new Array(pathLength);
  const constants = new Array(pathLength);
  for (let i = 0; i < pathLength; i++) {
    const mode = reader.readByte();
    modes[i] = mode;
    if (mode === PATH_SHAPE_CONST_INT) {
      constants[i] = reader.readVarint();
    } else if (mode === PATH_SHAPE_CONST_STRING) {
      constants[i] = reader.readString();
    } else if (mode !== PATH_SHAPE_VAR_INT && mode !== PATH_SHAPE_VAR_STRING) {
      throw new TypeError('invalid binary patch path shape mode');
    }
  }

  const patch = new Array(count);
  for (let i = 0; i < count; i++) {
    const path = new Array(pathLength);
    for (let j = 0; j < pathLength; j++) {
      const mode = modes[j];
      if (mode === PATH_SHAPE_CONST_INT || mode === PATH_SHAPE_CONST_STRING) {
        path[j] = constants[j];
      } else if (mode === PATH_SHAPE_VAR_INT) {
        path[j] = reader.readVarint();
      } else {
        path[j] = reader.readString();
      }
    }
    patch[i] = [OP_SET, path, readBinaryValue(reader)];
  }
  return patch;
}

function readSetPathShapeSignedIntPatch(reader) {
  const count = reader.readVarint();
  const pathLength = reader.readVarint();
  const modes = new Array(pathLength);
  const constants = new Array(pathLength);
  for (let i = 0; i < pathLength; i++) {
    const mode = reader.readByte();
    modes[i] = mode;
    if (mode === PATH_SHAPE_CONST_INT) {
      constants[i] = reader.readVarint();
    } else if (mode === PATH_SHAPE_CONST_STRING) {
      constants[i] = reader.readString();
    } else if (mode !== PATH_SHAPE_VAR_INT && mode !== PATH_SHAPE_VAR_STRING) {
      throw new TypeError('invalid binary patch path shape mode');
    }
  }

  const patch = new Array(count);
  for (let i = 0; i < count; i++) {
    const path = new Array(pathLength);
    for (let j = 0; j < pathLength; j++) {
      const mode = modes[j];
      if (mode === PATH_SHAPE_CONST_INT || mode === PATH_SHAPE_CONST_STRING) {
        path[j] = constants[j];
      } else if (mode === PATH_SHAPE_VAR_INT) {
        path[j] = reader.readVarint();
      } else {
        path[j] = reader.readString();
      }
    }
    patch[i] = [OP_SET, path, reader.readSignedVarint()];
  }
  return patch;
}

function getRootArrayObjectValueChangedPatch(patch) {
  if (patch.length !== 1) return null;
  const op = patch[0];
  if (
    !Array.isArray(op) ||
    op[0] !== OP_ARRAY_OBJECT_ASSIGN ||
    op.length !== 4 ||
    !Array.isArray(op[1]) ||
    op[1].length !== 0 ||
    !Array.isArray(op[2]) ||
    !Array.isArray(op[3]) ||
    op[2].length !== op[3].length ||
    op[2].length < 4
  ) {
    return null;
  }

  const values = op[3];
  for (let i = 0, length = values.length; i < length; i++) {
    const value = values[i];
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.changed !== true ||
      !Number.isSafeInteger(value.value) ||
      Object.is(value.value, -0) ||
      !hasExactlyTwoKeys(value, 'value', 'changed')
    ) {
      return null;
    }
  }

  const indexes = op[2];
  const start = indexes[0];
  const step = indexes.length > 1 ? indexes[1] - start : 0;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(step) ||
    step < 0
  ) {
    return null;
  }
  for (let i = 1, length = indexes.length; i < length; i++) {
    if (!Number.isSafeInteger(indexes[i]) || indexes[i] < 0 || indexes[i] !== start + step * i) return null;
  }

  return [op, start, step];
}

function writeRootArrayObjectValueChangedPatch(writer, patchInfo) {
  const op = patchInfo[0];
  const values = op[3];
  writer.writeVarint(values.length);
  writer.writeVarint(patchInfo[1]);
  writer.writeVarint(patchInfo[2]);
  for (let i = 0, length = values.length; i < length; i++) {
    writer.writeSignedVarint(values[i].value);
  }
}

function readRootArrayObjectValueChangedPatch(reader) {
  const length = reader.readVarint();
  const start = reader.readVarint();
  const step = reader.readVarint();
  const indexes = new Array(length);
  const values = new Array(length);
  for (let i = 0; i < length; i++) {
    indexes[i] = start + step * i;
    values[i] = {
      value: reader.readSignedVarint(),
      changed: true
    };
  }
  return [[OP_ARRAY_OBJECT_ASSIGN, [], indexes, values]];
}

function getRootArrayObjectFieldValueChangedPatch(patch) {
  if (patch.length !== 1) return null;
  const op = patch[0];
  if (
    !Array.isArray(op) ||
    op[0] !== OP_ARRAY_OBJECT_FIELD_ASSIGN ||
    op.length !== 5 ||
    !Array.isArray(op[1]) ||
    op[1].length !== 0 ||
    !Array.isArray(op[2]) ||
    !Array.isArray(op[3]) ||
    !Array.isArray(op[4]) ||
    op[2].length < 4 ||
    op[3].length !== 2 ||
    op[4].length !== op[2].length * 2
  ) {
    return null;
  }

  const valueField = op[3][0];
  const changedField = op[3][1];
  if (
    !Array.isArray(valueField) ||
    valueField.length !== 1 ||
    valueField[0] !== 'value' ||
    !Array.isArray(changedField) ||
    changedField.length !== 1 ||
    changedField[0] !== 'changed'
  ) {
    return null;
  }

  const indexes = op[2];
  const start = indexes[0];
  const step = indexes.length > 1 ? indexes[1] - start : 0;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(step) ||
    step < 0
  ) {
    return null;
  }

  for (let i = 0, length = indexes.length; i < length; i++) {
    if (!Number.isSafeInteger(indexes[i]) || indexes[i] < 0 || indexes[i] !== start + step * i) {
      return null;
    }
  }

  const values = op[4];
  for (let i = 0, length = indexes.length; i < length; i++) {
    const value = values[i * 2];
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || values[i * 2 + 1] !== true) {
      return null;
    }
  }

  return [op, start, step];
}

function writeRootArrayObjectFieldValueChangedPatch(writer, patchInfo) {
  const op = patchInfo[0];
  const indexes = op[2];
  const values = op[4];
  writer.writeVarint(indexes.length);
  writer.writeVarint(patchInfo[1]);
  writer.writeVarint(patchInfo[2]);
  for (let i = 0, length = indexes.length; i < length; i++) {
    writer.writeSignedVarint(values[i * 2]);
  }
}

function readRootArrayObjectFieldValueChangedPatch(reader) {
  const length = reader.readVarint();
  const start = reader.readVarint();
  const step = reader.readVarint();
  const indexes = new Array(length);
  const values = new Array(length * 2);
  for (let i = 0; i < length; i++) {
    indexes[i] = start + step * i;
    values[i * 2] = reader.readSignedVarint();
    values[i * 2 + 1] = true;
  }
  return [[OP_ARRAY_OBJECT_FIELD_ASSIGN, [], indexes, [['value'], ['changed']], values]];
}

function getSmallStructuralPatch(patch) {
  if (!Array.isArray(patch) || patch.length !== 3) return null;
  const op0 = patch[0];
  const op1 = patch[1];
  const op2 = patch[2];
  if (
    !Array.isArray(op0) || op0.length !== 5 || op0[0] !== OP_ARRAY_SPLICE ||
    !Array.isArray(op1) || op1.length !== 3 || op1[0] !== OP_ASSIGN ||
    !Array.isArray(op2) || op2.length !== 3 || op2[0] !== OP_SET
  ) {
    return null;
  }

  const path0 = op0[1];
  const start = op0[2];
  const deleteCount = op0[3];
  const insert = op0[4];
  const path1 = op1[1];
  const object = op1[2];
  const path2 = op2[1];
  const value2 = op2[2];
  if (
    !isSmallPrimitiveSegmentPath(path0, 8) ||
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(deleteCount) ||
    deleteCount < 0 ||
    !isSmallPrimitiveValueArray(insert, 32) ||
    !isSmallPrimitiveSegmentPath(path1, 8) ||
    object === null ||
    typeof object !== 'object' ||
    Array.isArray(object) ||
    !isSmallPrimitiveSegmentPath(path2, 8) ||
    !isPrimitiveJsonScalar(value2)
  ) {
    return null;
  }

  const keys = Object.keys(object);
  if (keys.length === 0 || keys.length > 16) return null;
  for (let i = 0, length = keys.length; i < length; i++) {
    if (!isPrimitiveJsonScalar(object[keys[i]])) return null;
  }
  return [op0, op1, op2, keys];
}

function isSmallPrimitiveSegmentPath(value, maxLength: number): boolean {
  return Array.isArray(value) && value.length <= maxLength && isPrimitiveSegmentArray(value);
}

function isSmallPrimitiveValueArray(value, maxLength: number): boolean {
  return Array.isArray(value) && value.length <= maxLength && isPrimitiveValueArray(value);
}

function writeSmallStructuralPatch(writer, patchInfo) {
  const op0 = patchInfo[0];
  const op1 = patchInfo[1];
  const op2 = patchInfo[2];
  const keys = patchInfo[3];
  writePath(writer, op0[1]);
  writer.writeVarint(op0[2]);
  writer.writeVarint(op0[3]);
  writePrimitiveArrayPayload(writer, op0[4]);

  writePath(writer, op1[1]);
  const object = op1[2];
  writer.writeVarint(keys.length);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    writer.writeString(key);
    writeBinaryValue(writer, object[key]);
  }

  writePath(writer, op2[1]);
  writeBinaryValue(writer, op2[2]);
}

function readSmallStructuralPatch(reader) {
  const path0 = readPath(reader);
  const start = reader.readVarint();
  const deleteCount = reader.readVarint();
  const insert = readPrimitiveArrayPayload(reader);
  const path1 = readPath(reader);
  const object = {};
  const keyCount = reader.readVarint();
  for (let i = 0; i < keyCount; i++) {
    setDecodedValue(object, reader.readString(), readBinaryValue(reader));
  }
  const path2 = readPath(reader);
  return [
    [OP_ARRAY_SPLICE, path0, start, deleteCount, insert],
    [OP_ASSIGN, path1, object],
    [OP_SET, path2, readBinaryValue(reader)]
  ];
}

function getAssignObjectPatch(patch) {
  if (!Array.isArray(patch) || patch.length !== 1) return null;
  const op = patch[0];
  if (
    !Array.isArray(op) ||
    op.length !== 3 ||
    op[0] !== OP_ASSIGN ||
    !isSmallPrimitiveSegmentPath(op[1], 8)
  ) {
    return null;
  }

  const object = op[2];
  if (object === null || typeof object !== 'object' || Array.isArray(object)) return null;
  const keys = Object.keys(object);
  if (keys.length === 0 || keys.length > 32) return null;
  const keyPlan = getCompactAssignKeyPlan(keys);
  if (!hasCompactAssignObjectShape(object, keys, keyPlan)) return null;
  return [op[1], object, keys, keyPlan];
}

function hasCompactAssignObjectShape(object, keys, keyPlan = getCompactAssignKeyPlan(keys)) {
  if (keyPlan !== null) return true;
  return hasCompactAssignObjectValues(object, keys);
}

function hasCompactAssignObjectValues(object, keys) {
  for (let i = 0, length = keys.length; i < length; i++) {
    const value = object[keys[i]];
    if (isSingleBooleanObject(value) || isStringArray(value) || isSafeIntegerArray(value)) return true;
  }
  return false;
}

function hasCompactAssignKeyList(keys) {
  return getCompactAssignKeyPlan(keys) !== null;
}

function writeAssignObjectPayload(writer, object, keys, keyPlan = undefined) {
  writeAssignObjectKeys(writer, keys, keyPlan);
  for (let i = 0, length = keys.length; i < length; i++) {
    writeRootRemoveAssignValue(writer, object[keys[i]]);
  }
}

function readAssignObjectPayload(reader) {
  const keys = readAssignObjectKeys(reader);
  const object = {};
  for (let i = 0, length = keys.length; i < length; i++) {
    setDecodedValue(object, keys[i], readRootRemoveAssignValue(reader));
  }
  return object;
}

function writeAssignObjectKeys(writer, keys, keyPlan = undefined) {
  const plan = keyPlan === undefined ? getCompactAssignKeyPlan(keys) : keyPlan;
  if (plan !== null && plan[0] === ASSIGN_KEYS_NUMERIC_SUFFIX) {
    const numericSuffix = plan[1];
    writer.writeByte(ASSIGN_KEYS_NUMERIC_SUFFIX);
    writer.writeVarint(keys.length);
    writer.writeString(numericSuffix[0]);
    const suffixes = numericSuffix[1];
    for (let i = 0, length = suffixes.length; i < length; i++) {
      writer.writeVarint(suffixes[i]);
    }
    return;
  }

  writer.writeByte(ASSIGN_KEYS_RAW);
  writer.writeVarint(keys.length);
  for (let i = 0, length = keys.length; i < length; i++) {
    writer.writeString(keys[i]);
  }
}

function readAssignObjectKeys(reader) {
  const mode = reader.readByte();
  const length = reader.readVarint();
  const keys = new Array(length);
  if (mode === ASSIGN_KEYS_RAW) {
    for (let i = 0; i < length; i++) {
      keys[i] = reader.readString();
    }
    return keys;
  }

  if (mode === ASSIGN_KEYS_NUMERIC_SUFFIX) {
    const prefix = reader.readString();
    for (let i = 0; i < length; i++) {
      keys[i] = prefix + reader.readVarint();
    }
    return keys;
  }

  throw new TypeError('invalid binary patch assign key mode');
}

function getNumericSuffixKeyList(keys) {
  if (keys.length < 2) return null;
  const first = splitNumericSuffix(keys[0]);
  if (first === null || first[0].length === 0) return null;

  const suffixes = new Array(keys.length);
  suffixes[0] = first[1];
  for (let i = 1, length = keys.length; i < length; i++) {
    const current = splitNumericSuffix(keys[i]);
    if (current === null || current[0] !== first[0]) return null;
    suffixes[i] = current[1];
  }
  return [first[0], suffixes];
}

function getCompactAssignKeyPlan(keys) {
  const numericSuffix = getNumericSuffixKeyList(keys);
  if (numericSuffix !== null) return [ASSIGN_KEYS_NUMERIC_SUFFIX, numericSuffix];
  return null;
}

function splitNumericSuffix(key) {
  let index = key.length;
  while (index > 0) {
    const code = key.charCodeAt(index - 1);
    if (code < 48 || code > 57) break;
    index--;
  }
  if (index === key.length) return null;
  if (key.charCodeAt(index) === 48 && index + 1 < key.length) return null;

  let value = 0;
  for (let i = index, length = key.length; i < length; i++) {
    value = value * 10 + key.charCodeAt(i) - 48;
    if (!Number.isSafeInteger(value)) return null;
  }
  return [key.slice(0, index), value];
}

function getRootRemoveAssignPatch(patch) {
  if (!Array.isArray(patch) || patch.length !== 2) return null;
  const remove = patch[0];
  const assign = patch[1];
  if (
    !Array.isArray(remove) || remove.length !== 2 || remove[0] !== OP_REMOVE ||
    !Array.isArray(assign) || assign.length !== 3 || assign[0] !== OP_ASSIGN ||
    !isSmallPrimitiveSegmentPath(remove[1], 8) ||
    !Array.isArray(assign[1]) || assign[1].length !== 0
  ) {
    return null;
  }

  const object = assign[2];
  if (object === null || typeof object !== 'object' || Array.isArray(object)) return null;
  const keys = Object.keys(object);
  if (keys.length === 0 || keys.length > 16) return null;
  return [remove, object, keys];
}

function writeRootRemoveAssignPatch(writer, patchInfo) {
  writePath(writer, patchInfo[0][1]);
  const object = patchInfo[1];
  const keys = patchInfo[2];
  writer.writeVarint(keys.length);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    writer.writeString(key);
    writeRootRemoveAssignValue(writer, object[key]);
  }
}

function readRootRemoveAssignPatch(reader) {
  const removePath = readPath(reader);
  const object = {};
  const keyCount = reader.readVarint();
  for (let i = 0; i < keyCount; i++) {
    setDecodedValue(object, reader.readString(), readRootRemoveAssignValue(reader));
  }
  return [
    [OP_REMOVE, removePath],
    [OP_ASSIGN, [], object]
  ];
}

function writeRootRemoveAssignValue(writer, value) {
  if (value === null) {
    writer.writeByte(0);
  } else if (value === false) {
    writer.writeByte(1);
  } else if (value === true) {
    writer.writeByte(2);
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    writer.writeByte(3);
    writer.writeSignedVarint(value);
  } else if (typeof value === 'string') {
    writer.writeByte(4);
    writer.writeString(value);
  } else if (isSingleBooleanObject(value)) {
    const key = Object.keys(value)[0];
    writer.writeByte(value[key] ? 5 : 6);
    writer.writeString(key);
  } else if (isStringArray(value)) {
    writer.writeByte(8);
    writer.writeVarint(value.length);
    for (let i = 0, length = value.length; i < length; i++) {
      writer.writeString(value[i]);
    }
  } else if (isSafeIntegerArray(value)) {
    writer.writeByte(9);
    writer.writeVarint(value.length);
    for (let i = 0, length = value.length; i < length; i++) {
      writer.writeSignedVarint(value[i]);
    }
  } else {
    writer.writeByte(7);
    writeBinaryValue(writer, value);
  }
}

function readRootRemoveAssignValue(reader) {
  const tag = reader.readByte();
  if (tag === 0) return null;
  if (tag === 1) return false;
  if (tag === 2) return true;
  if (tag === 3) return reader.readSignedVarint();
  if (tag === 4) return reader.readString();
  if (tag === 5 || tag === 6) {
    const object = {};
    setDecodedValue(object, reader.readString(), tag === 5);
    return object;
  }
  if (tag === 7) return readBinaryValue(reader);
  if (tag === 8) {
    const length = reader.readVarint();
    const values = new Array(length);
    for (let i = 0; i < length; i++) {
      values[i] = reader.readString();
    }
    return values;
  }
  if (tag === 9) {
    const length = reader.readVarint();
    const values = new Array(length);
    for (let i = 0; i < length; i++) {
      values[i] = reader.readSignedVarint();
    }
    return values;
  }
  throw new TypeError('invalid root remove/assign value tag');
}

function isSingleBooleanObject(value): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && typeof value[keys[0]] === 'boolean';
}

function isStringArray(value): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return false;
  for (let i = 0, length = value.length; i < length; i++) {
    if (typeof value[i] !== 'string') return false;
  }
  return true;
}

function isSafeIntegerArray(value): value is number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return false;
  for (let i = 0, length = value.length; i < length; i++) {
    if (!Number.isSafeInteger(value[i]) || Object.is(value[i], -0)) return false;
  }
  return true;
}

function writePrimitiveArrayPayload(writer, values) {
  writer.writeVarint(values.length);
  for (let i = 0, length = values.length; i < length; i++) {
    writeBinaryValue(writer, values[i]);
  }
}

function readPrimitiveArrayPayload(reader) {
  const length = reader.readVarint();
  const values = new Array(length);
  for (let i = 0; i < length; i++) {
    values[i] = readBinaryValue(reader);
  }
  return values;
}

function setDecodedValue(object, key, value) {
  if (key === '__proto__') {
    setOwnValue(object, key, value);
  } else {
    object[key] = value;
  }
}

function getRootStringSpliceOperation(patch) {
  if (patch.length !== 1) return null;
  const op = patch[0];
  if (
    Array.isArray(op) &&
    op[0] === OP_STRING_SPLICE &&
    op.length === 5 &&
    Array.isArray(op[1]) &&
    op[1].length === 0
  ) {
    return op;
  }
  return null;
}

function getRootStringSpliceCopyPatch(patch) {
  if (patch.length !== 2) return null;
  const splice = patch[0];
  const copy = patch[1];
  if (
    Array.isArray(splice) &&
    splice[0] === OP_STRING_SPLICE &&
    splice.length === 5 &&
    Array.isArray(splice[1]) &&
    splice[1].length === 0 &&
    Array.isArray(copy) &&
    copy[0] === OP_STRING_COPY &&
    copy.length === 5 &&
    Array.isArray(copy[1]) &&
    copy[1].length === 0
  ) {
    return patch;
  }
  return null;
}

function getRootAppendIntRunOperation(patch) {
  if (patch.length !== 1) return null;
  const op = patch[0];
  if (
    !Array.isArray(op) ||
    op[0] !== OP_APPEND ||
    op.length !== 3 ||
    !Array.isArray(op[1]) ||
    op[1].length !== 0 ||
    !Array.isArray(op[2]) ||
    op[2].length < 4
  ) {
    return null;
  }

  const values = op[2];
  let value = values[0];
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) return null;
  for (let i = 1, length = values.length; i < length; i++) {
    value++;
    if (values[i] !== value) return null;
  }

  return [values.length, values[0]];
}

function hasExactlyTwoKeys(value, key0, key1) {
  let mask = 0;
  for (const key in value) {
    if (!hasOwn.call(value, key)) continue;
    if (key === key0) mask |= 1;
    else if (key === key1) mask |= 2;
    else return false;
  }
  return mask === 3;
}

function objectShapeKey(keys) {
  let out = '';
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    out += key.length + ':' + key;
  }
  return out;
}

function recordArrayShape(value) {
  const length = value.length;
  if (length < 4) return null;

  const first = value[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return null;

  const keys = Object.keys(first);
  const keyCount = keys.length;
  if (keyCount < 2) return null;

  for (let i = 1; i < length; i++) {
    const row = value[i];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    const rowKeys = Object.keys(row);
    if (rowKeys.length !== keyCount) return null;
    for (let j = 0; j < keyCount; j++) {
      if (rowKeys[j] !== keys[j]) return null;
    }
  }

  return keys;
}

function recordArrayModes(rows, shape) {
  const length = rows.length;
  const modes = new Array(shape.length);
  let specialized = 0;

  for (let keyIndex = 0, keyCount = shape.length; keyIndex < keyCount; keyIndex++) {
    const key = shape[keyIndex];
    const first = rows[0][key];
    const firstType = first === null ? 'null' : typeof first;
    let constant = first === null || firstType === 'boolean' || firstType === 'number' || firstType === 'string';
    let bools = firstType === 'boolean';
    let signedInts = firstType === 'number' && Number.isSafeInteger(first) && !Object.is(first, -0);
    let strings = firstType === 'string';

    for (let i = 1; i < length; i++) {
      const value = rows[i][key];
      if (constant && value !== first) constant = false;
      if (bools && typeof value !== 'boolean') bools = false;
      if (signedInts && (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0))) {
        signedInts = false;
      }
      if (strings && typeof value !== 'string') strings = false;

      if (!constant && !bools && !signedInts && !strings) break;
    }

    if (constant) {
      modes[keyIndex] = RECORD_FIELD_CONST;
      specialized++;
    } else if (bools) {
      modes[keyIndex] = RECORD_FIELD_BOOL;
      specialized++;
    } else if (signedInts) {
      modes[keyIndex] = RECORD_FIELD_SIGNED_INT;
      specialized++;
    } else if (strings) {
      modes[keyIndex] = RECORD_FIELD_STRING;
      specialized++;
    } else {
      modes[keyIndex] = RECORD_FIELD_GENERIC;
    }
  }

  return specialized === 0 ? null : modes;
}

function writeColumnarRecordArray(writer, rows, shape, modes) {
  writer.writeVarint(rows.length);
  writer.writeVarint(shape.length);
  for (let i = 0, length = shape.length; i < length; i++) {
    writer.writeString(shape[i]);
    writer.writeByte(modes[i]);
  }

  for (let keyIndex = 0, keyCount = shape.length; keyIndex < keyCount; keyIndex++) {
    const key = shape[keyIndex];
    const mode = modes[keyIndex];

    if (mode === RECORD_FIELD_CONST) {
      writeBinaryValue(writer, rows[0][key]);
    } else if (mode === RECORD_FIELD_BOOL) {
      writeBooleanColumn(writer, rows, key);
    } else if (mode === RECORD_FIELD_SIGNED_INT) {
      for (let i = 0, length = rows.length; i < length; i++) {
        writer.writeSignedVarint(rows[i][key]);
      }
    } else if (mode === RECORD_FIELD_STRING) {
      for (let i = 0, length = rows.length; i < length; i++) {
        writer.writeString(rows[i][key]);
      }
    } else {
      for (let i = 0, length = rows.length; i < length; i++) {
        writeBinaryValue(writer, rows[i][key]);
      }
    }
  }
}

function readColumnarRecordArray(reader) {
  const length = reader.readVarint();
  const keyCount = reader.readVarint();
  const shape = new Array(keyCount);
  const modes = new Array(keyCount);
  for (let i = 0; i < keyCount; i++) {
    shape[i] = reader.readString();
    modes[i] = reader.readByte();
  }
  const useDirectSet = length >= 32 && !shapeHasProtoKey(shape);

  if (isRepeatedRecordColumnShape(shape, modes)) {
    return readRepeatedRecordColumnarRows(reader, length);
  }

  const rows = new Array(length);
  for (let i = 0; i < length; i++) rows[i] = {};

  for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
    const key = shape[keyIndex];
    const mode = modes[keyIndex];

    if (mode === RECORD_FIELD_CONST) {
      const value = readBinaryValue(reader);
      if (useDirectSet) {
        for (let i = 0; i < length; i++) {
          rows[i][key] = value;
        }
      } else {
        for (let i = 0; i < length; i++) {
          setDecodedValue(rows[i], key, value);
        }
      }
    } else if (mode === RECORD_FIELD_BOOL) {
      readBooleanColumn(reader, rows, key, useDirectSet);
    } else if (mode === RECORD_FIELD_SIGNED_INT) {
      if (useDirectSet) {
        for (let i = 0; i < length; i++) {
          rows[i][key] = reader.readSignedVarint();
        }
      } else {
        for (let i = 0; i < length; i++) {
          setDecodedValue(rows[i], key, reader.readSignedVarint());
        }
      }
    } else if (mode === RECORD_FIELD_STRING) {
      if (useDirectSet) {
        for (let i = 0; i < length; i++) {
          rows[i][key] = reader.readString();
        }
      } else {
        for (let i = 0; i < length; i++) {
          setDecodedValue(rows[i], key, reader.readString());
        }
      }
    } else if (mode === RECORD_FIELD_GENERIC) {
      if (useDirectSet) {
        for (let i = 0; i < length; i++) {
          rows[i][key] = readBinaryValue(reader);
        }
      } else {
        for (let i = 0; i < length; i++) {
          setDecodedValue(rows[i], key, readBinaryValue(reader));
        }
      }
    } else {
      throw new TypeError('invalid binary record field mode');
    }
  }

  return rows;
}

function isRepeatedRecordRows(rows) {
  const length = rows.length;
  if (length < 4) return false;

  const first = rows[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return false;
  const firstKeys = Object.keys(first);
  if (
    firstKeys.length !== 5 ||
    firstKeys[0] !== 'id' ||
    firstKeys[1] !== 'kind' ||
    firstKeys[2] !== 'bucket' ||
    firstKeys[3] !== 'label' ||
    firstKeys[4] !== 'active'
  ) {
    return false;
  }

  const kind = first.kind;
  const kindType = kind === null ? 'null' : typeof kind;
  if (kind !== null && kindType !== 'boolean' && kindType !== 'number' && kindType !== 'string') return false;

  for (let i = 0; i < length; i++) {
    const row = rows[i];
    if (
      row === null ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      !Number.isSafeInteger(row.id) ||
      Object.is(row.id, -0) ||
      row.kind !== kind ||
      !Number.isSafeInteger(row.bucket) ||
      Object.is(row.bucket, -0) ||
      typeof row.label !== 'string' ||
      typeof row.active !== 'boolean' ||
      !hasOnlyRepeatedRecordKeys(row)
    ) {
      return false;
    }
  }

  return true;
}

function isRepeatedRecordColumnShape(shape, modes) {
  return shape.length === 5 &&
    shape[0] === 'id' &&
    shape[1] === 'kind' &&
    shape[2] === 'bucket' &&
    shape[3] === 'label' &&
    shape[4] === 'active' &&
    modes[0] === RECORD_FIELD_SIGNED_INT &&
    modes[1] === RECORD_FIELD_CONST &&
    modes[2] === RECORD_FIELD_SIGNED_INT &&
    modes[3] === RECORD_FIELD_STRING &&
    modes[4] === RECORD_FIELD_BOOL;
}

function writeRepeatedRecordColumnarArray(writer, rows) {
  const length = rows.length;
  writer.writeVarint(length);
  writer.writeVarint(5);
  writer.writeString('id');
  writer.writeByte(RECORD_FIELD_SIGNED_INT);
  writer.writeString('kind');
  writer.writeByte(RECORD_FIELD_CONST);
  writer.writeString('bucket');
  writer.writeByte(RECORD_FIELD_SIGNED_INT);
  writer.writeString('label');
  writer.writeByte(RECORD_FIELD_STRING);
  writer.writeString('active');
  writer.writeByte(RECORD_FIELD_BOOL);

  for (let i = 0; i < length; i++) {
    writer.writeSignedVarint(rows[i].id);
  }

  writeBinaryValue(writer, rows[0].kind);

  for (let i = 0; i < length; i++) {
    writer.writeSignedVarint(rows[i].bucket);
  }

  for (let i = 0; i < length; i++) {
    writer.writeString(rows[i].label);
  }

  writeRepeatedRecordActiveColumn(writer, rows);
}

function readRepeatedRecordColumnarRows(reader, length) {
  const ids = new Array(length);
  for (let i = 0; i < length; i++) {
    ids[i] = reader.readSignedVarint();
  }

  const kind = readBinaryValue(reader);

  const buckets = new Array(length);
  for (let i = 0; i < length; i++) {
    buckets[i] = reader.readSignedVarint();
  }

  const labels = new Array(length);
  for (let i = 0; i < length; i++) {
    labels[i] = reader.readString();
  }

  const rows = new Array(length);
  let index = 0;
  while (index < length) {
    const byte = reader.readByte();
    const end = index + 8 < length ? index + 8 : length;
    for (let bit = 0; index < end; bit++, index++) {
      rows[index] = {
        id: ids[index],
        kind,
        bucket: buckets[index],
        label: labels[index],
        active: (byte & (1 << bit)) !== 0
      };
    }
  }
  return rows;
}

function hasOnlyRepeatedRecordKeys(row) {
  let mask = 0;
  let count = 0;
  for (const key in row) {
    if (!hasOwn.call(row, key)) continue;
    count++;
    if (key === 'id') mask |= 1;
    else if (key === 'kind') mask |= 2;
    else if (key === 'bucket') mask |= 4;
    else if (key === 'label') mask |= 8;
    else if (key === 'active') mask |= 16;
    else return false;
  }
  return count === 5 && mask === 31;
}

function shapeHasProtoKey(shape) {
  for (let i = 0, length = shape.length; i < length; i++) {
    if (shape[i] === '__proto__') return true;
  }
  return false;
}

function writeBooleanColumn(writer, rows, key) {
  let i = 0;
  const length = rows.length;
  while (i < length) {
    let byte = 0;
    const end = i + 8 < length ? i + 8 : length;
    for (let bit = 0; i < end; bit++, i++) {
      if (rows[i][key]) byte |= 1 << bit;
    }
    writer.writeByte(byte);
  }
}

function writeRepeatedRecordActiveColumn(writer, rows) {
  let i = 0;
  const length = rows.length;
  while (i < length) {
    let byte = 0;
    const end = i + 8 < length ? i + 8 : length;
    for (let bit = 0; i < end; bit++, i++) {
      if (rows[i].active) byte |= 1 << bit;
    }
    writer.writeByte(byte);
  }
}

function readBooleanColumn(reader, rows, key, hasProtoKey) {
  let i = 0;
  const length = rows.length;
  if (hasProtoKey) {
    while (i < length) {
      const byte = reader.readByte();
      const end = i + 8 < length ? i + 8 : length;
      for (let bit = 0; i < end; bit++, i++) {
        setDecodedValue(rows[i], key, (byte & (1 << bit)) !== 0);
      }
    }
  } else {
    while (i < length) {
      const byte = reader.readByte();
      const end = i + 8 < length ? i + 8 : length;
      for (let bit = 0; i < end; bit++, i++) {
        rows[i][key] = (byte & (1 << bit)) !== 0;
      }
    }
  }
}

function writeRecordArrayRows(writer, value, shape) {
  const length = value.length;

  if (shape.length === 2) {
    const k0 = shape[0];
    const k1 = shape[1];
    for (let i = 0; i < length; i++) {
      const row = value[i];
      writeBinaryValue(writer, row[k0]);
      writeBinaryValue(writer, row[k1]);
    }
    return;
  }

  if (shape.length === 3) {
    const k0 = shape[0];
    const k1 = shape[1];
    const k2 = shape[2];
    for (let i = 0; i < length; i++) {
      const row = value[i];
      writeBinaryValue(writer, row[k0]);
      writeBinaryValue(writer, row[k1]);
      writeBinaryValue(writer, row[k2]);
    }
    return;
  }

  if (shape.length === 4) {
    const k0 = shape[0];
    const k1 = shape[1];
    const k2 = shape[2];
    const k3 = shape[3];
    for (let i = 0; i < length; i++) {
      const row = value[i];
      writeBinaryValue(writer, row[k0]);
      writeBinaryValue(writer, row[k1]);
      writeBinaryValue(writer, row[k2]);
      writeBinaryValue(writer, row[k3]);
    }
    return;
  }

  if (shape.length === 5) {
    const k0 = shape[0];
    const k1 = shape[1];
    const k2 = shape[2];
    const k3 = shape[3];
    const k4 = shape[4];
    for (let i = 0; i < length; i++) {
      const row = value[i];
      writeBinaryValue(writer, row[k0]);
      writeBinaryValue(writer, row[k1]);
      writeBinaryValue(writer, row[k2]);
      writeBinaryValue(writer, row[k3]);
      writeBinaryValue(writer, row[k4]);
    }
    return;
  }

  if (shape.length === 6) {
    const k0 = shape[0];
    const k1 = shape[1];
    const k2 = shape[2];
    const k3 = shape[3];
    const k4 = shape[4];
    const k5 = shape[5];
    for (let i = 0; i < length; i++) {
      const row = value[i];
      writeBinaryValue(writer, row[k0]);
      writeBinaryValue(writer, row[k1]);
      writeBinaryValue(writer, row[k2]);
      writeBinaryValue(writer, row[k3]);
      writeBinaryValue(writer, row[k4]);
      writeBinaryValue(writer, row[k5]);
    }
    return;
  }

  for (let i = 0; i < length; i++) {
    const row = value[i];
    for (let j = 0, keyCount = shape.length; j < keyCount; j++) {
      writeBinaryValue(writer, row[shape[j]]);
    }
  }
}

function readRecordArrayRows(reader, length, shape) {
  const array = new Array(length);

  if (shape.length === 2) {
    const k0 = shape[0];
    const k1 = shape[1];
    for (let i = 0; i < length; i++) {
      const object = {};
      setDecodedValue(object, k0, readBinaryValue(reader));
      setDecodedValue(object, k1, readBinaryValue(reader));
      array[i] = object;
    }
    return array;
  }

  if (shape.length === 3) {
    const k0 = shape[0];
    const k1 = shape[1];
    const k2 = shape[2];
    for (let i = 0; i < length; i++) {
      const object = {};
      setDecodedValue(object, k0, readBinaryValue(reader));
      setDecodedValue(object, k1, readBinaryValue(reader));
      setDecodedValue(object, k2, readBinaryValue(reader));
      array[i] = object;
    }
    return array;
  }

  if (shape.length === 4) {
    const k0 = shape[0];
    const k1 = shape[1];
    const k2 = shape[2];
    const k3 = shape[3];
    for (let i = 0; i < length; i++) {
      const object = {};
      setDecodedValue(object, k0, readBinaryValue(reader));
      setDecodedValue(object, k1, readBinaryValue(reader));
      setDecodedValue(object, k2, readBinaryValue(reader));
      setDecodedValue(object, k3, readBinaryValue(reader));
      array[i] = object;
    }
    return array;
  }

  if (shape.length === 5) {
    const k0 = shape[0];
    const k1 = shape[1];
    const k2 = shape[2];
    const k3 = shape[3];
    const k4 = shape[4];
    for (let i = 0; i < length; i++) {
      const object = {};
      setDecodedValue(object, k0, readBinaryValue(reader));
      setDecodedValue(object, k1, readBinaryValue(reader));
      setDecodedValue(object, k2, readBinaryValue(reader));
      setDecodedValue(object, k3, readBinaryValue(reader));
      setDecodedValue(object, k4, readBinaryValue(reader));
      array[i] = object;
    }
    return array;
  }

  if (shape.length === 6) {
    const k0 = shape[0];
    const k1 = shape[1];
    const k2 = shape[2];
    const k3 = shape[3];
    const k4 = shape[4];
    const k5 = shape[5];
    for (let i = 0; i < length; i++) {
      const object = {};
      setDecodedValue(object, k0, readBinaryValue(reader));
      setDecodedValue(object, k1, readBinaryValue(reader));
      setDecodedValue(object, k2, readBinaryValue(reader));
      setDecodedValue(object, k3, readBinaryValue(reader));
      setDecodedValue(object, k4, readBinaryValue(reader));
      setDecodedValue(object, k5, readBinaryValue(reader));
      array[i] = object;
    }
    return array;
  }

  for (let i = 0; i < length; i++) {
    const object = {};
    for (let j = 0, keyCount = shape.length; j < keyCount; j++) {
      setDecodedValue(object, shape[j], readBinaryValue(reader));
    }
    array[i] = object;
  }
  return array;
}

class BinaryWriter {
  bytes: Uint8Array;
  view: DataView;
  offset: number;
  strings: Map<string, number>;
  shapes: Map<string, number>;
  shapeCount: number;

  constructor() {
    this.bytes = new Uint8Array(256);
    this.view = new DataView(this.bytes.buffer);
    this.offset = 0;
    this.strings = new Map();
    this.shapes = new Map();
    this.shapeCount = 0;
  }

  finish() {
    return this.bytes.slice(0, this.offset);
  }

  ensure(size) {
    const needed = this.offset + size;
    if (needed <= this.bytes.length) return;

    let nextLength = this.bytes.length << 1;
    while (nextLength < needed) nextLength <<= 1;
    const next = new Uint8Array(nextLength);
    next.set(this.bytes);
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  writeByte(value) {
    this.ensure(1);
    this.bytes[this.offset++] = value;
  }

  writeBytes(values) {
    this.ensure(values.length);
    this.bytes.set(values, this.offset);
    this.offset += values.length;
  }

  writeVarint(value) {
    this.ensure(10);
    const bytes = this.bytes;
    let offset = this.offset;
    while (value >= 0x80) {
      bytes[offset++] = (value % 0x80) | 0x80;
      value = Math.floor(value / 0x80);
    }
    bytes[offset++] = value;
    this.offset = offset;
  }

  writeSignedVarint(value) {
    this.writeVarint(value < 0 ? (-value * 2) - 1 : value * 2);
  }

  writeDouble(value) {
    this.ensure(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }

  writeString(value) {
    const index = this.strings.get(value);
    if (index !== undefined) {
      this.writeByte(STRING_REF);
      this.writeVarint(index);
      return;
    }

    this.strings.set(value, this.strings.size);
    if (hasUnpairedSurrogate(value)) {
      this.writeByte(STRING_UTF16);
      this.writeUtf16StringPayload(value);
      return;
    }

    this.writeByte(STRING_NEW);
    if (value.length <= 64 && this.writeAsciiStringBytes(value)) {
      return;
    }

    const bytes = textEncoder.encode(value);
    this.writeVarint(bytes.length);
    this.writeBytes(bytes);
  }

  writeAsciiStringBytes(value) {
    const length = value.length;
    for (let i = 0; i < length; i++) {
      if (value.charCodeAt(i) > 0x7f) return false;
    }

    this.writeVarint(length);
    this.ensure(length);
    const bytes = this.bytes;
    let offset = this.offset;
    for (let i = 0; i < length; i++) {
      bytes[offset++] = value.charCodeAt(i);
    }
    this.offset = offset;
    return true;
  }

  writeRawString(value) {
    if (hasUnpairedSurrogate(value)) {
      this.writeVarint(RAW_STRING_UTF16_SENTINEL);
      this.writeUtf16StringPayload(value);
      return;
    }

    if (value.length >= 64 && typeof textEncoder.encodeInto === 'function') {
      const maxLength = value.length * 3;
      this.ensure(10 + maxLength);
      const start = this.offset;
      const payloadOffset = start + 10;
      const result = textEncoder.encodeInto(value, this.bytes.subarray(payloadOffset, payloadOffset + maxLength));
      if (result.read === value.length) {
        const written = result.written;
        const varintLength = this.writeVarintAt(start, written);
        if (varintLength !== 10) {
          this.bytes.copyWithin(start + varintLength, payloadOffset, payloadOffset + written);
        }
        this.offset = start + varintLength + written;
        return;
      }
    }

    const bytes = textEncoder.encode(value);
    this.writeVarint(bytes.length);
    this.writeBytes(bytes);
  }

  writeUtf16StringPayload(value) {
    const length = value.length;
    this.writeVarint(length);
    this.ensure(length * 2);
    let offset = this.offset;
    const bytes = this.bytes;
    for (let i = 0; i < length; i++) {
      const code = value.charCodeAt(i);
      bytes[offset++] = code & 0xff;
      bytes[offset++] = code >>> 8;
    }
    this.offset = offset;
  }

  writeVarintAt(offset, value) {
    const start = offset;
    while (value >= 0x80) {
      this.bytes[offset++] = (value % 0x80) | 0x80;
      value = Math.floor(value / 0x80);
    }
    this.bytes[offset++] = value;
    return offset - start;
  }
}

class BinaryReader {
  bytes: Uint8Array;
  view: DataView;
  offset: number;
  strings: string[];
  shapes: string[][];

  constructor(value: ArrayBuffer | ArrayBufferView) {
    if (value instanceof Uint8Array) {
      this.bytes = value;
    } else if (value instanceof ArrayBuffer) {
      this.bytes = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      this.bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      throw new TypeError('binary patch data must be an ArrayBuffer or typed array');
    }

    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
    this.strings = [];
    this.shapes = [];
  }

  readByte() {
    if (this.offset >= this.bytes.length) throw new TypeError('unexpected end of binary patch data');
    return this.bytes[this.offset++];
  }

  readVarint() {
    const bytes = this.bytes;
    let offset = this.offset;
    let value = 0;
    let multiplier = 1;

    for (;;) {
      if (offset >= bytes.length) throw new TypeError('unexpected end of binary patch data');
      const byte = bytes[offset++];
      value += (byte & 0x7f) * multiplier;
      if (byte < 0x80) {
        this.offset = offset;
        return value;
      }
      multiplier *= 0x80;
      if (multiplier > Number.MAX_SAFE_INTEGER) {
        this.offset = offset;
        throw new TypeError('binary patch varint exceeds safe integer range');
      }
    }
  }

  readSignedVarint() {
    const value = this.readVarint();
    return value % 2 === 1 ? -((value + 1) / 2) : value / 2;
  }

  readDouble() {
    if (this.offset + 8 > this.bytes.length) throw new TypeError('unexpected end of binary patch data');
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readString() {
    const token = this.readByte();
    if (token === STRING_REF) {
      const value = this.strings[this.readVarint()];
      if (value === undefined) throw new TypeError('invalid binary patch string reference');
      return value;
    }
    if (token === STRING_UTF16) {
      const value = this.readUtf16StringPayload();
      this.strings[this.strings.length] = value;
      return value;
    }
    if (token !== STRING_NEW) throw new TypeError('invalid binary patch string token');

    const length = this.readVarint();
    if (this.offset + length > this.bytes.length) throw new TypeError('unexpected end of binary patch data');
    const end = this.offset + length;
    let value;
    if (length <= 64) {
      value = this.readAsciiStringIfPossible(this.offset, end);
      if (value !== null) {
        this.offset = end;
        this.strings[this.strings.length] = value;
        return value;
      }
    }

    value = textDecoder.decode(this.bytes.subarray(this.offset, end));
    this.offset = end;
    this.strings[this.strings.length] = value;
    return value;
  }

  readAsciiStringIfPossible(start, end) {
    const bytes = this.bytes;
    for (let i = start; i < end; i++) {
      if (bytes[i] > 0x7f) return null;
    }

    let value = '';
    for (let i = start; i < end; i++) {
      value += String.fromCharCode(bytes[i]);
    }
    return value;
  }

  readRawString() {
    const length = this.readVarint();
    if (length === RAW_STRING_UTF16_SENTINEL) {
      return this.readUtf16StringPayload();
    }
    if (this.offset + length > this.bytes.length) throw new TypeError('unexpected end of binary patch data');
    const value = textDecoder.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  readUtf16StringPayload() {
    const length = this.readVarint();
    const byteLength = length * 2;
    if (this.offset + byteLength > this.bytes.length) throw new TypeError('unexpected end of binary patch data');
    const value = decodeUtf16String(this.bytes, this.offset, length);
    this.offset += byteLength;
    return value;
  }
}

function hasUnpairedSurrogate(value) {
  if (stringIsWellFormed !== undefined) {
    return !stringIsWellFormed.call(value);
  }
  return UNPAIRED_SURROGATE_PATTERN.test(value);
}

function decodeUtf16String(bytes, offset, length) {
  if (length === 0) return '';

  const chunkSize = 8192;
  let value = '';
  let remaining = length;
  let readOffset = offset;
  while (remaining > 0) {
    const count = remaining < chunkSize ? remaining : chunkSize;
    const codes = new Array(count);
    for (let i = 0; i < count; i++) {
      codes[i] = bytes[readOffset] | (bytes[readOffset + 1] << 8);
      readOffset += 2;
    }
    value += String.fromCharCode(...codes);
    remaining -= count;
  }
  return value;
}
