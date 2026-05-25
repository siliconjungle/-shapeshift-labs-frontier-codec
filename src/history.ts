import {
  OP_APPEND,
  OP_ARRAY_ASSIGN,
  OP_ARRAY_MOVE,
  OP_ARRAY_OBJECT_ASSIGN,
  OP_ARRAY_OBJECT_FIELD_ASSIGN,
  OP_ARRAY_SPLICE,
  OP_ARRAY_TUPLE_ASSIGN,
  OP_ARRAY_TWO_FIELD_INSERT,
  OP_ASSIGN,
  OP_REMOVE,
  OP_SET,
  OP_SCALAR_ARRAY_REPLACE,
  OP_STRING_COPY,
  OP_STRING_SPLICE,
  OP_TRUNCATE
} from '@shapeshift-labs/frontier/constants';
import { assertPatch } from '@shapeshift-labs/frontier/patch';
import { applyPatchImmutable } from '@shapeshift-labs/frontier/apply';
import { cloneJson } from '@shapeshift-labs/frontier/clone';
import { setOwnValue } from './object.js';
import type {
  JsonArray,
  JsonObject,
  JsonPath,
  JsonPrimitive,
  JsonValue,
  Patch,
  PatchHistoryBuilder,
  PatchHistoryCodecOptions,
  PatchOperation
} from './types.js';

const HISTORY_MAGIC_0 = 0x6a; // j
const HISTORY_MAGIC_1 = 0x64; // d
const HISTORY_MAGIC_2 = 0x68; // h
const HISTORY_VERSION = 1;
const HISTORY_MODE_GENERIC = 0;
const HISTORY_MODE_SET_COLUMNS = 1;
const HISTORY_MODE_STRING_SPLICE = 2;
const HISTORY_MODE_ROW_FIELD_ASSIGN = 3;
const HISTORY_MODE_STRING_APPEND = 4;
const HISTORY_MODE_ROW_OBJECT_ASSIGN = 5;
const HISTORY_MODE_ASSIGN_COLUMNS = 6;
const SEGMENT_NUMBER = 0;
const SEGMENT_STRING = 1;
const INDEX_RAW = 0;
const INDEX_DELTA = 1;
const INDEX_RUN = 2;
const INDEX_U64_BITMAP = 3;
const VALUE_NULL = 0;
const VALUE_FALSE = 1;
const VALUE_TRUE = 2;
const VALUE_INT = 3;
const VALUE_DOUBLE = 4;
const VALUE_STRING = 5;
const VALUE_ARRAY = 6;
const VALUE_OBJECT = 7;
const COLUMN_VALUES = 0;
const COLUMN_CONST = 1;
const COLUMN_INT_ARITHMETIC = 2;
const UINT_LIST_RAW = 0;
const UINT_LIST_ARITHMETIC = 1;
const UINT_LIST_DELTA = 2;
const UINT_LIST_PERIODIC = 3;
const VALUE_LIST_VALUES = 0;
const VALUE_LIST_SIGNED_INT_DELTA = 1;
const VALUE_LIST_TWO_FIELD_SIGNED_INT_DELTA = 2;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const objectHasOwn = Object.prototype.hasOwnProperty;
const BYTE_POPCOUNT = createBytePopcountTable();
const BYTE_INDEXES = createByteIndexTable();

export function encodePatchHistory(patches: Patch[], options?: PatchHistoryCodecOptions): Uint8Array {
  if (!Array.isArray(patches)) throw new TypeError('patch history must be an array of patches');
  if (!options || options.validate !== false) {
    for (let i = 0, length = patches.length; i < length; i++) assertPatch(patches[i]);
  }

  const compactSetColumns = tryEncodeSetColumnHistory(patches);
  if (compactSetColumns !== null) return compactSetColumns;

  const compactAssignColumns = tryEncodeAssignColumnHistory(patches);
  if (compactAssignColumns !== null) return compactAssignColumns;

  const compactRowFieldAssign = tryEncodeRowFieldAssignHistory(patches);
  if (compactRowFieldAssign !== null) return compactRowFieldAssign;

  const compactTwoFieldIntegerRowObjectAssign = tryEncodeTwoFieldIntegerRowObjectAssignHistory(patches);
  if (compactTwoFieldIntegerRowObjectAssign !== null) return compactTwoFieldIntegerRowObjectAssign;

  const compactRowObjectAssign = tryEncodeRowObjectAssignHistory(patches);
  if (compactRowObjectAssign !== null) return compactRowObjectAssign;

  const compactStringAppend = tryEncodeStringAppendHistory(patches);
  if (compactStringAppend !== null) return compactStringAppend;

  const compactStringSplice = tryEncodeStringSpliceHistory(patches);
  if (compactStringSplice !== null) return compactStringSplice;

  const pathMap = new Map<string, number>();
  const paths: JsonPath[] = [];
  for (let i = 0, patchCount = patches.length; i < patchCount; i++) {
    const patch = patches[i];
    for (let j = 0, opCount = patch.length; j < opCount; j++) {
      const op = patch[j];
      internPath(pathMap, paths, op[1]);
      if (op[0] === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
        const fields = op[3];
        for (let k = 0, fieldCount = fields.length; k < fieldCount; k++) {
          internPath(pathMap, paths, fields[k]);
        }
      }
    }
  }

  const writer = new HistoryWriter();
  writer.writeByte(HISTORY_MAGIC_0);
  writer.writeByte(HISTORY_MAGIC_1);
  writer.writeByte(HISTORY_MAGIC_2);
  writer.writeByte(HISTORY_VERSION);
  writer.writeByte(HISTORY_MODE_GENERIC);
  writer.writeVarint(paths.length);
  for (let i = 0, length = paths.length; i < length; i++) writePath(writer, paths[i]);
  writer.writeVarint(patches.length);
  for (let i = 0, patchCount = patches.length; i < patchCount; i++) {
    const patch = patches[i];
    writer.writeVarint(patch.length);
    for (let j = 0, opCount = patch.length; j < opCount; j++) {
      writeHistoryOperation(writer, pathMap, patch[j]);
    }
  }
  return writer.finish();
}

export function createPatchHistoryBuilder(): PatchHistoryBuilder {
  return new StreamingPatchHistoryBuilder();
}

export function decodePatchHistory(bytes: ArrayBuffer | ArrayBufferView, options?: PatchHistoryCodecOptions): Patch[] {
  const reader = new HistoryReader(bytes);
  if (
    reader.readByte() !== HISTORY_MAGIC_0 ||
    reader.readByte() !== HISTORY_MAGIC_1 ||
    reader.readByte() !== HISTORY_MAGIC_2 ||
    reader.readByte() !== HISTORY_VERSION
  ) {
    throw new TypeError('invalid binary patch history header');
  }

  const mode = reader.readByte();
  if (mode === HISTORY_MODE_SET_COLUMNS) return decodeSetColumnHistory(reader, options);
  if (mode === HISTORY_MODE_ASSIGN_COLUMNS) return decodeAssignColumnHistory(reader, options);
  if (mode === HISTORY_MODE_STRING_SPLICE) return decodeStringSpliceHistory(reader, options);
  if (mode === HISTORY_MODE_ROW_FIELD_ASSIGN) return decodeRowFieldAssignHistory(reader, options);
  if (mode === HISTORY_MODE_STRING_APPEND) return decodeStringAppendHistory(reader, options);
  if (mode === HISTORY_MODE_ROW_OBJECT_ASSIGN) return decodeRowObjectAssignHistory(reader, options);
  if (mode !== HISTORY_MODE_GENERIC) throw new TypeError('unknown binary patch history mode');

  const pathCount = reader.readVarint();
  const paths = new Array<JsonPath>(pathCount);
  for (let i = 0; i < pathCount; i++) paths[i] = readPath(reader);

  const patchCount = reader.readVarint();
  const patches = new Array<Patch>(patchCount);
  for (let i = 0; i < patchCount; i++) {
    const opCount = reader.readVarint();
    const patch = new Array<PatchOperation>(opCount);
    for (let j = 0; j < opCount; j++) {
      patch[j] = readHistoryOperation(reader, paths);
    }
    patches[i] = patch;
  }

  if (reader.offset !== reader.bytes.length) {
    throw new TypeError('unexpected trailing binary patch history data');
  }
  if (!options || options.validate !== false) {
    for (let i = 0; i < patches.length; i++) assertPatch(patches[i]);
  }
  return patches;
}

export function applyEncodedPatchHistory(source: JsonValue, bytes: ArrayBuffer | ArrayBufferView, options?: PatchHistoryCodecOptions): JsonValue {
  const reader = new HistoryReader(bytes);
  if (
    reader.readByte() !== HISTORY_MAGIC_0 ||
    reader.readByte() !== HISTORY_MAGIC_1 ||
    reader.readByte() !== HISTORY_MAGIC_2 ||
    reader.readByte() !== HISTORY_VERSION
  ) {
    throw new TypeError('invalid binary patch history header');
  }

  const mode = reader.readByte();
  if (mode === HISTORY_MODE_STRING_APPEND) {
    return applyEncodedStringAppendHistory(source, bytes, reader, options);
  }
  if (mode === HISTORY_MODE_STRING_SPLICE) {
    return applyEncodedStringSpliceHistory(source, bytes, reader, options);
  }
  if (mode === HISTORY_MODE_SET_COLUMNS) {
    return applyEncodedSetColumnHistory(source, bytes, reader, options);
  }
  if (mode === HISTORY_MODE_ASSIGN_COLUMNS) {
    return applyEncodedAssignColumnHistory(source, bytes, reader, options);
  }
  if (mode === HISTORY_MODE_ROW_FIELD_ASSIGN) {
    return applyEncodedRowFieldAssignHistory(source, bytes, reader, options);
  }
  if (mode === HISTORY_MODE_ROW_OBJECT_ASSIGN) {
    return applyEncodedRowObjectAssignHistory(source, bytes, reader, options);
  }
  if (mode === HISTORY_MODE_GENERIC && options && options.validate === false) {
    return applyEncodedGenericHistory(source, reader, options);
  }
  return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
}

export function applyPatchHistory(source: JsonValue, patches: Patch[], options?: PatchHistoryCodecOptions): JsonValue {
  if (!Array.isArray(patches)) throw new TypeError('patch history must be an array of patches');
  const patchCount = readHistoryUntil(options, patches.length);
  const stringResult = tryApplyStringSpliceHistory(source, patches, patchCount);
  if (stringResult !== null) return stringResult;

  const setColumnResult = tryApplySetColumnHistory(source, patches, patchCount);
  if (setColumnResult !== null) return setColumnResult;

  const assignColumnResult = tryApplyAssignColumnHistory(source, patches, patchCount);
  if (assignColumnResult !== null) return assignColumnResult;

  const rowFieldResult = tryApplyRowFieldAssignHistory(source, patches, patchCount);
  if (rowFieldResult !== null) return rowFieldResult;

  const rowObjectResult = tryApplyRowObjectAssignHistory(source, patches, patchCount);
  if (rowObjectResult !== null) return rowObjectResult;

  let value = source;
  for (let i = 0; i < patchCount; i++) {
    value = applyPatchImmutable(value, patches[i]);
  }
  return value;
}

function readHistoryUntil(options: PatchHistoryCodecOptions | undefined, patchCount: number): number {
  const until = options && options.until;
  if (until === undefined) return patchCount;
  if (!Number.isSafeInteger(until) || until < 0) {
    throw new TypeError('patch history until must be a non-negative safe integer');
  }
  return until > patchCount ? patchCount : until;
}

function applyEncodedGenericHistory(source: JsonValue, reader: HistoryReader, options?: PatchHistoryCodecOptions): JsonValue {
  const pathCount = reader.readVarint();
  const paths = new Array<JsonPath>(pathCount);
  for (let i = 0; i < pathCount; i++) paths[i] = readPath(reader);

  const patchCount = reader.readVarint();
  const until = readHistoryUntil(options, patchCount);
  let value = source;
  for (let i = 0; i < patchCount; i++) {
    const opCount = reader.readVarint();
    const patch = i < until ? new Array<PatchOperation>(opCount) : null;
    for (let j = 0; j < opCount; j++) {
      if (patch === null) {
        skipHistoryOperation(reader, paths);
      } else {
        patch[j] = readHistoryOperation(reader, paths);
      }
    }
    if (patch !== null && opCount !== 0) {
      value = applyPatchImmutable(value, patch);
    }
  }

  if (reader.offset !== reader.bytes.length) {
    throw new TypeError('unexpected trailing binary patch history data');
  }
  return value;
}

class StreamingPatchHistoryBuilder implements PatchHistoryBuilder {
  appendPath: JsonPath | null = null;
  appendPathSource: JsonPath | null = null;
  appendStart = 0;
  appendCursor = 0;
  appendIds: number[] = [];
  appendDictionary: string[] = [];
  appendDictionaryIds = new Map<string, number>();
  fallbackPatches: Patch[] | null = null;

  get length(): number {
    return this.fallbackPatches === null ? this.appendIds.length : this.fallbackPatches.length;
  }

  addPatch(patch: Patch): this {
    if (!Array.isArray(patch)) throw new TypeError('history builder patch must be an array');
    if (
      patch.length === 1 &&
      patch[0][0] === OP_STRING_SPLICE &&
      this.tryAppendStringSplice(patch[0][1], patch[0][2], patch[0][3], patch[0][4])
    ) {
      return this;
    }

    this.ensureFallbackPatches();
    this.fallbackPatches![this.fallbackPatches!.length] = patch;
    return this;
  }

  stringSplice(path: JsonPath, start: number, deleteCount: number, insert: string): this {
    if (!this.tryAppendStringSplice(path, start, deleteCount, insert)) {
      this.ensureFallbackPatches();
      this.fallbackPatches![this.fallbackPatches!.length] = [[OP_STRING_SPLICE, path.slice(), start, deleteCount, insert]];
    }
    return this;
  }

  appendString(path: JsonPath, start: number, insert: string): this {
    return this.stringSplice(path, start, 0, insert);
  }

  finish(options?: PatchHistoryCodecOptions): Uint8Array {
    if (this.fallbackPatches !== null) return encodePatchHistory(this.fallbackPatches, options);
    if (this.appendIds.length === 0 || this.appendPath === null) return encodePatchHistory([], options);

    const writer = createHistoryWriter(HISTORY_MODE_STRING_APPEND);
    writePath(writer, this.appendPath);
    writer.writeVarint(this.appendIds.length);
    writer.writeVarint(this.appendStart);
    writeStringDictionaryIds(writer, this.appendDictionary, this.appendIds);
    return writer.finish();
  }

  reset(): void {
    this.appendPath = null;
    this.appendPathSource = null;
    this.appendStart = 0;
    this.appendCursor = 0;
    this.appendIds.length = 0;
    this.appendDictionary.length = 0;
    this.appendDictionaryIds.clear();
    this.fallbackPatches = null;
  }

  tryAppendStringSplice(path: JsonPath, start: number, deleteCount: number, insert: string): boolean {
    validateBuilderStringSplice(path, start, deleteCount, insert);
    if (deleteCount !== 0) return false;
    if (this.fallbackPatches !== null) return false;

    if (this.appendPath === null) {
      this.appendPathSource = path;
      this.appendPath = path.slice();
      this.appendStart = start;
      this.appendCursor = start;
    } else if (path !== this.appendPathSource && !samePath(path, this.appendPath)) {
      return false;
    }

    if (start !== this.appendCursor) return false;
    this.appendIds[this.appendIds.length] = this.internAppendString(insert);
    this.appendCursor += insert.length;
    return true;
  }

  internAppendString(value: string): number {
    let id = this.appendDictionaryIds.get(value);
    if (id === undefined) {
      id = this.appendDictionary.length;
      this.appendDictionary[id] = value;
      this.appendDictionaryIds.set(value, id);
    }
    return id;
  }

  ensureFallbackPatches(): void {
    if (this.fallbackPatches !== null) return;
    const patches = new Array<Patch>(this.appendIds.length);
    if (this.appendPath !== null) {
      let cursor = this.appendStart;
      for (let i = 0, length = this.appendIds.length; i < length; i++) {
        const insert = this.appendDictionary[this.appendIds[i]];
        patches[i] = [[OP_STRING_SPLICE, this.appendPath.slice(), cursor, 0, insert]];
        cursor += insert.length;
      }
    }
    this.fallbackPatches = patches;
  }
}

function validateBuilderStringSplice(path: JsonPath, start: number, deleteCount: number, insert: string): void {
  if (!Array.isArray(path)) throw new TypeError('history builder string splice path must be an array');
  if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('history builder string splice start must be a non-negative safe integer');
  if (!Number.isSafeInteger(deleteCount) || deleteCount < 0) throw new TypeError('history builder string splice delete count must be a non-negative safe integer');
  if (typeof insert !== 'string') throw new TypeError('history builder string splice insert must be a string');
}

function tryApplyStringSpliceHistory(source: JsonValue, patches: Patch[], patchCount = patches.length): JsonValue | null {
  if (patchCount === 0) return source;
  const firstPatch = patches[0];
  if (firstPatch.length !== 1 || firstPatch[0][0] !== OP_STRING_SPLICE) return null;
  const path = firstPatch[0][1];
  let text = readStringAtPath(source, path);
  if (text === null) return null;

  let appendOnly = true;
  let cursor = text.length;
  const inserts: string[] = [];
  for (let i = 0; i < patchCount; i++) {
    const patch = patches[i];
    if (patch.length !== 1 || patch[0][0] !== OP_STRING_SPLICE) return null;
    const op = patch[0];
    if (!samePath(op[1], path)) return null;
    if (op[3] !== 0 || op[2] !== cursor) {
      appendOnly = false;
      break;
    }
    inserts[inserts.length] = op[4];
    cursor += op[4].length;
  }

  if (appendOnly) {
    return setPathValueImmutable(source, path, text + inserts.join(''));
  }

  text = readStringAtPath(source, path);
  if (text === null) return null;
  for (let i = 0; i < patchCount; i++) {
    const op = patches[i][0] as [typeof OP_STRING_SPLICE, JsonPath, number, number, string];
    text = text.slice(0, op[2]) + op[4] + text.slice(op[2] + op[3]);
  }
  return setPathValueImmutable(source, path, text);
}

function tryApplySetColumnHistory(source: JsonValue, patches: Patch[], patchCount: number): JsonValue | null {
  if (patchCount === 0) return source;
  if (patchCount < 8) return null;

  const firstPatch = patches[0];
  const columnCount = firstPatch.length;
  if (columnCount === 0) return null;
  const paths = new Array<JsonPath>(columnCount);
  for (let column = 0; column < columnCount; column++) {
    const op = firstPatch[column];
    if (op[0] !== OP_SET) return null;
    paths[column] = op[1];
  }

  for (let patchIndex = 1; patchIndex < patchCount; patchIndex++) {
    const patch = patches[patchIndex];
    if (patch.length !== columnCount) return null;
    for (let column = 0; column < columnCount; column++) {
      const op = patch[column];
      if (op[0] !== OP_SET || !samePath(op[1], paths[column])) return null;
    }
  }

  const finalPatch = patches[patchCount - 1];
  let value = source;
  for (let column = 0; column < columnCount; column++) {
    value = setPathValueImmutable(value, paths[column], cloneHistoryPatchValue(finalPatch[column][2]));
  }
  return value;
}

function tryApplyAssignColumnHistory(source: JsonValue, patches: Patch[], patchCount: number): JsonValue | null {
  if (patchCount === 0) return source;
  if (patchCount < 8) return null;

  const firstPatch = patches[0];
  const assignCount = firstPatch.length;
  if (assignCount === 0) return null;
  const paths = new Array<JsonPath>(assignCount);
  const keysByAssign = new Array<string[]>(assignCount);
  for (let column = 0; column < assignCount; column++) {
    const op = firstPatch[column];
    if (op[0] !== OP_ASSIGN) return null;
    const keys = readAssignKeys(op[2]);
    if (keys === null) return null;
    paths[column] = op[1];
    keysByAssign[column] = keys;
  }

  for (let patchIndex = 1; patchIndex < patchCount; patchIndex++) {
    const patch = patches[patchIndex];
    if (patch.length !== assignCount) return null;
    for (let column = 0; column < assignCount; column++) {
      const op = patch[column];
      if (op[0] !== OP_ASSIGN || !samePath(op[1], paths[column]) || !hasAssignKeys(op[2], keysByAssign[column])) {
        return null;
      }
    }
  }

  const finalPatch = patches[patchCount - 1];
  let value = source;
  for (let column = 0; column < assignCount; column++) {
    const nextValue = assignPathValuesImmutable(value, paths[column], finalPatch[column][2] as JsonObject, true);
    if (nextValue === null) return null;
    value = nextValue;
  }
  return value;
}

function tryApplyRowFieldAssignHistory(source: JsonValue, patches: Patch[], patchCount: number): JsonValue | null {
  if (patchCount === 0) return source;
  if (patchCount < 8) return null;

  const firstPatch = patches[0];
  if (firstPatch.length === 0 || firstPatch[0][0] !== OP_ARRAY_OBJECT_FIELD_ASSIGN) return null;
  const firstRowOp = firstPatch[0] as [typeof OP_ARRAY_OBJECT_FIELD_ASSIGN, JsonPath, number[], JsonPath[], JsonValue[]];
  const basePath = firstRowOp[1];
  const fieldPaths = firstRowOp[3];
  const fieldCount = fieldPaths.length;
  if (fieldCount === 0 || firstRowOp[4].length !== firstRowOp[2].length * fieldCount) return null;

  const setColumnCount = firstPatch.length - 1;
  const setPaths = new Array<JsonPath>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    const op = firstPatch[column + 1];
    if (op[0] !== OP_SET) return null;
    setPaths[column] = op[1];
  }

  const rowIndexes: number[] = [];
  const rowValues: Array<JsonValue[] | undefined> = [];
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    const patch = patches[patchIndex];
    if (patch.length !== firstPatch.length || patch[0][0] !== OP_ARRAY_OBJECT_FIELD_ASSIGN) return null;
    const rowOp = patch[0] as [typeof OP_ARRAY_OBJECT_FIELD_ASSIGN, JsonPath, number[], JsonPath[], JsonValue[]];
    if (
      !samePath(rowOp[1], basePath) ||
      !samePathList(rowOp[3], fieldPaths) ||
      rowOp[4].length !== rowOp[2].length * fieldCount
    ) {
      return null;
    }

    for (let column = 0; column < setColumnCount; column++) {
      const op = patch[column + 1];
      if (op[0] !== OP_SET || !samePath(op[1], setPaths[column])) return null;
    }

    const indexes = rowOp[2];
    const values = rowOp[4];
    for (let rowOffset = 0, rowCount = indexes.length; rowOffset < rowCount; rowOffset++) {
      const rowIndex = indexes[rowOffset];
      if (rowValues[rowIndex] === undefined) rowIndexes[rowIndexes.length] = rowIndex;
      const valueOffset = rowOffset * fieldCount;
      const row = new Array<JsonValue>(fieldCount);
      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        row[fieldIndex] = cloneHistoryPatchValue(values[valueOffset + fieldIndex]);
      }
      rowValues[rowIndex] = row;
    }
  }

  let value = source;
  if (rowIndexes.length !== 0) {
    const rowResult = applyRowFieldHistoryFinal(value, basePath, fieldPaths, rowIndexes, rowValues);
    if (rowResult === null) return null;
    value = rowResult;
  }

  const finalPatch = patches[patchCount - 1];
  for (let column = 0; column < setColumnCount; column++) {
    value = setPathValueImmutable(value, setPaths[column], cloneHistoryPatchValue(finalPatch[column + 1][2]));
  }
  return value;
}

function tryApplyRowObjectAssignHistory(source: JsonValue, patches: Patch[], patchCount: number): JsonValue | null {
  if (patchCount === 0) return source;
  if (patchCount < 8) return null;

  const firstPatch = patches[0];
  if (firstPatch.length === 0 || firstPatch[0][0] !== OP_ARRAY_OBJECT_ASSIGN) return null;
  const firstRowOp = firstPatch[0] as [typeof OP_ARRAY_OBJECT_ASSIGN, JsonPath, number[], JsonObject[]];
  const basePath = firstRowOp[1];
  if (firstRowOp[2].length !== firstRowOp[3].length) return null;
  const keys = getUniformAssignKeys(firstRowOp[3]);
  if (keys === null) return null;
  const fieldCount = keys.length;
  const fieldPaths = new Array<JsonPath>(fieldCount);
  for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) fieldPaths[fieldIndex] = [keys[fieldIndex]];

  const setColumnCount = firstPatch.length - 1;
  const setPaths = new Array<JsonPath>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    const op = firstPatch[column + 1];
    if (op[0] !== OP_SET) return null;
    setPaths[column] = op[1];
  }

  const rowIndexes: number[] = [];
  const rowValues: Array<JsonValue[] | undefined> = [];
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    const patch = patches[patchIndex];
    if (patch.length !== firstPatch.length || patch[0][0] !== OP_ARRAY_OBJECT_ASSIGN) return null;
    const rowOp = patch[0] as [typeof OP_ARRAY_OBJECT_ASSIGN, JsonPath, number[], JsonObject[]];
    if (
      !samePath(rowOp[1], basePath) ||
      rowOp[2].length !== rowOp[3].length ||
      !hasUniformAssignKeys(rowOp[3], keys)
    ) {
      return null;
    }

    for (let column = 0; column < setColumnCount; column++) {
      const op = patch[column + 1];
      if (op[0] !== OP_SET || !samePath(op[1], setPaths[column])) return null;
    }

    const indexes = rowOp[2];
    const assigns = rowOp[3];
    for (let rowOffset = 0, rowCount = indexes.length; rowOffset < rowCount; rowOffset++) {
      const rowIndex = indexes[rowOffset];
      if (rowValues[rowIndex] === undefined) rowIndexes[rowIndexes.length] = rowIndex;
      const assign = assigns[rowOffset];
      const values = new Array<JsonValue>(fieldCount);
      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        values[fieldIndex] = cloneHistoryPatchValue(assign[keys[fieldIndex]]);
      }
      rowValues[rowIndex] = values;
    }
  }

  let value = source;
  if (rowIndexes.length !== 0) {
    const rowResult = applyRowFieldHistoryFinal(value, basePath, fieldPaths, rowIndexes, rowValues);
    if (rowResult === null) return null;
    value = rowResult;
  }

  const finalPatch = patches[patchCount - 1];
  for (let column = 0; column < setColumnCount; column++) {
    value = setPathValueImmutable(value, setPaths[column], cloneHistoryPatchValue(finalPatch[column + 1][2]));
  }
  return value;
}

function cloneHistoryPatchValue(value: JsonValue): JsonValue {
  return value !== null && typeof value === 'object' ? cloneJson(value) : value;
}

function readStringAtPath(source: JsonValue, path: JsonPath): string | null {
  let value: JsonValue = source;
  for (let i = 0, length = path.length; i < length; i++) {
    if (value === null || typeof value !== 'object') return null;
    value = (value as JsonObject | JsonArray)[path[i]];
  }
  return typeof value === 'string' ? value : null;
}

function setPathValueImmutable(source: JsonValue, path: JsonPath, value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  const root = shallowCloneContainer(source);
  let originalNode = source as JsonObject | JsonArray;
  let clonedNode = root as JsonObject | JsonArray;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    const key = path[i];
    const child = shallowCloneContainer(originalNode[key]);
    setOwnValue(clonedNode, key, child);
    originalNode = originalNode[key] as JsonObject | JsonArray;
    clonedNode = child as JsonObject | JsonArray;
  }
  setOwnValue(clonedNode, path[path.length - 1], value);
  return root;
}

function assignPathValuesImmutable(source: JsonValue, path: JsonPath, assign: JsonObject, cloneValues: boolean): JsonValue | null {
  if (path.length === 0) {
    const root = tryShallowCloneContainer(source);
    if (root === null) return null;
    assignHistoryValues(root as JsonObject | JsonArray, assign, cloneValues);
    return root;
  }

  const root = tryShallowCloneContainer(source);
  if (root === null) return null;
  let originalNode = source as JsonObject | JsonArray;
  let clonedNode = root as JsonObject | JsonArray;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    const key = path[i];
    const nextOriginal = originalNode[key];
    const child = tryShallowCloneContainer(nextOriginal);
    if (child === null) return null;
    setOwnValue(clonedNode, key, child);
    originalNode = nextOriginal as JsonObject | JsonArray;
    clonedNode = child as JsonObject | JsonArray;
  }

  const key = path[path.length - 1];
  const target = tryShallowCloneContainer(originalNode[key]);
  if (target === null) return null;
  setOwnValue(clonedNode, key, target);
  assignHistoryValues(target as JsonObject | JsonArray, assign, cloneValues);
  return root;
}

function assignHistoryValues(target: JsonObject | JsonArray, assign: JsonObject, cloneValues: boolean): void {
  const keys = Object.keys(assign);
  for (let i = 0, length = keys.length; i < length; i++) {
    const key = keys[i];
    const value = assign[key];
    setOwnValue(target, key, cloneValues ? cloneHistoryPatchValue(value) : value);
  }
}

function shallowCloneContainer(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.slice();
  if (value !== null && typeof value === 'object') return { ...(value as JsonObject) };
  throw new TypeError('cannot set nested patch history value on a scalar');
}

function tryShallowCloneContainer(value: JsonValue): JsonValue | null {
  if (Array.isArray(value)) return value.slice();
  if (value !== null && typeof value === 'object') return { ...(value as JsonObject) };
  return null;
}

function tryEncodeSetColumnHistory(patches: Patch[]): Uint8Array | null {
  const patchCount = patches.length;
  if (patchCount < 8) return null;
  const firstPatch = patches[0];
  const columnCount = firstPatch.length;
  if (columnCount === 0) return null;
  const paths = new Array<JsonPath>(columnCount);
  const values = new Array<JsonValue[]>(columnCount);
  for (let column = 0; column < columnCount; column++) {
    const op = firstPatch[column];
    if (op[0] !== OP_SET) return null;
    paths[column] = op[1];
    const columnValues = new Array<JsonValue>(patchCount);
    columnValues[0] = op[2];
    values[column] = columnValues;
  }

  for (let i = 1; i < patchCount; i++) {
    const patch = patches[i];
    if (patch.length !== columnCount) return null;
    for (let column = 0; column < columnCount; column++) {
      const op = patch[column];
      if (op[0] !== OP_SET || !samePath(op[1], paths[column])) return null;
      values[column][i] = op[2];
    }
  }

  const writer = createHistoryWriter(HISTORY_MODE_SET_COLUMNS);
  writer.writeVarint(patchCount);
  writer.writeVarint(columnCount);
  for (let column = 0; column < columnCount; column++) {
    writePath(writer, paths[column]);
    writeValueColumn(writer, values[column]);
  }
  return writer.finish();
}

function decodeSetColumnHistory(reader: HistoryReader, options?: PatchHistoryCodecOptions): Patch[] {
  const patchCount = reader.readVarint();
  const columnCount = reader.readVarint();
  const paths = new Array<JsonPath>(columnCount);
  const columns = new Array<JsonValue[]>(columnCount);
  for (let column = 0; column < columnCount; column++) {
    paths[column] = readPath(reader);
    columns[column] = readValueColumn(reader, patchCount);
  }
  const patches = new Array<Patch>(patchCount);
  for (let i = 0; i < patchCount; i++) {
    const patch = new Array<PatchOperation>(columnCount);
    for (let column = 0; column < columnCount; column++) {
      patch[column] = [OP_SET, paths[column].slice(), columns[column][i]];
    }
    patches[i] = patch;
  }
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (!options || options.validate !== false) {
    for (let i = 0; i < patches.length; i++) assertPatch(patches[i]);
  }
  return patches;
}

function tryEncodeAssignColumnHistory(patches: Patch[]): Uint8Array | null {
  const patchCount = patches.length;
  if (patchCount < 8) return null;
  const firstPatch = patches[0];
  const assignCount = firstPatch.length;
  if (assignCount === 0) return null;

  const paths = new Array<JsonPath>(assignCount);
  const keysByAssign = new Array<string[]>(assignCount);
  const valuesByAssign = new Array<JsonValue[][]>(assignCount);
  for (let assignIndex = 0; assignIndex < assignCount; assignIndex++) {
    const op = firstPatch[assignIndex];
    if (op[0] !== OP_ASSIGN) return null;
    const keys = readAssignKeys(op[2]);
    if (keys === null) return null;
    paths[assignIndex] = op[1];
    keysByAssign[assignIndex] = keys;

    const columns = new Array<JsonValue[]>(keys.length);
    for (let keyIndex = 0, keyCount = keys.length; keyIndex < keyCount; keyIndex++) {
      const values = new Array<JsonValue>(patchCount);
      values[0] = op[2][keys[keyIndex]];
      columns[keyIndex] = values;
    }
    valuesByAssign[assignIndex] = columns;
  }

  for (let patchIndex = 1; patchIndex < patchCount; patchIndex++) {
    const patch = patches[patchIndex];
    if (patch.length !== assignCount) return null;
    for (let assignIndex = 0; assignIndex < assignCount; assignIndex++) {
      const op = patch[assignIndex];
      const keys = keysByAssign[assignIndex];
      if (op[0] !== OP_ASSIGN || !samePath(op[1], paths[assignIndex]) || !hasAssignKeys(op[2], keys)) return null;
      const columns = valuesByAssign[assignIndex];
      for (let keyIndex = 0, keyCount = keys.length; keyIndex < keyCount; keyIndex++) {
        columns[keyIndex][patchIndex] = op[2][keys[keyIndex]];
      }
    }
  }

  const writer = createHistoryWriter(HISTORY_MODE_ASSIGN_COLUMNS);
  writer.writeVarint(patchCount);
  writer.writeVarint(assignCount);
  for (let assignIndex = 0; assignIndex < assignCount; assignIndex++) {
    const keys = keysByAssign[assignIndex];
    writePath(writer, paths[assignIndex]);
    writer.writeVarint(keys.length);
    for (let keyIndex = 0, keyCount = keys.length; keyIndex < keyCount; keyIndex++) writer.writeString(keys[keyIndex]);
    const columns = valuesByAssign[assignIndex];
    for (let keyIndex = 0, keyCount = keys.length; keyIndex < keyCount; keyIndex++) writeValueColumn(writer, columns[keyIndex]);
  }
  return writer.finish();
}

function decodeAssignColumnHistory(reader: HistoryReader, options?: PatchHistoryCodecOptions): Patch[] {
  const patchCount = reader.readVarint();
  const assignCount = reader.readVarint();
  const paths = new Array<JsonPath>(assignCount);
  const keysByAssign = new Array<string[]>(assignCount);
  const columnsByAssign = new Array<JsonValue[][]>(assignCount);
  for (let assignIndex = 0; assignIndex < assignCount; assignIndex++) {
    paths[assignIndex] = readPath(reader);
    const keyCount = reader.readVarint();
    const keys = new Array<string>(keyCount);
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) keys[keyIndex] = reader.readString();
    keysByAssign[assignIndex] = keys;

    const columns = new Array<JsonValue[]>(keyCount);
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) columns[keyIndex] = readValueColumn(reader, patchCount);
    columnsByAssign[assignIndex] = columns;
  }

  const patches = new Array<Patch>(patchCount);
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    const patch = new Array<PatchOperation>(assignCount);
    for (let assignIndex = 0; assignIndex < assignCount; assignIndex++) {
      const keys = keysByAssign[assignIndex];
      const columns = columnsByAssign[assignIndex];
      const assign: JsonObject = {};
      for (let keyIndex = 0, keyCount = keys.length; keyIndex < keyCount; keyIndex++) {
        setOwnValue(assign, keys[keyIndex], columns[keyIndex][patchIndex]);
      }
      patch[assignIndex] = [OP_ASSIGN, paths[assignIndex].slice(), assign];
    }
    patches[patchIndex] = patch;
  }

  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (!options || options.validate !== false) {
    for (let i = 0; i < patches.length; i++) assertPatch(patches[i]);
  }
  return patches;
}

function tryEncodeStringAppendHistory(patches: Patch[]): Uint8Array | null {
  const patchCount = patches.length;
  if (patchCount < 8) return null;
  const first = patches[0];
  if (first.length !== 1 || first[0][0] !== OP_STRING_SPLICE) return null;
  const firstOp = first[0];
  const path = firstOp[1];
  let cursor = firstOp[2];
  const inserts = new Array<string>(patchCount);

  for (let i = 0; i < patchCount; i++) {
    const patch = patches[i];
    if (patch.length !== 1 || patch[0][0] !== OP_STRING_SPLICE) return null;
    const op = patch[0];
    if (op[3] !== 0 || op[2] !== cursor || !samePath(op[1], path)) return null;
    const insert = op[4];
    inserts[i] = insert;
    cursor += insert.length;
  }

  const writer = createHistoryWriter(HISTORY_MODE_STRING_APPEND);
  writePath(writer, path);
  writer.writeVarint(patchCount);
  writer.writeVarint(firstOp[2]);
  writeStringDictionaryValues(writer, inserts);
  return writer.finish();
}

function decodeStringAppendHistory(reader: HistoryReader, options?: PatchHistoryCodecOptions): Patch[] {
  const path = readPath(reader);
  const patchCount = reader.readVarint();
  let cursor = reader.readVarint();
  const inserts = readStringDictionaryValues(reader, patchCount);
  const patches = new Array<Patch>(patchCount);
  for (let i = 0; i < patchCount; i++) {
    const insert = inserts[i];
    patches[i] = [[OP_STRING_SPLICE, path.slice(), cursor, 0, insert]];
    cursor += insert.length;
  }
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (!options || options.validate !== false) {
    for (let i = 0; i < patches.length; i++) assertPatch(patches[i]);
  }
  return patches;
}

function applyEncodedStringAppendHistory(
  source: JsonValue,
  bytes: ArrayBuffer | ArrayBufferView,
  reader: HistoryReader,
  options?: PatchHistoryCodecOptions
): JsonValue {
  const path = readPath(reader);
  const patchCount = reader.readVarint();
  const start = reader.readVarint();
  const until = readHistoryUntil(options, patchCount);
  const inserted = readStringDictionaryJoinedUntil(reader, patchCount, until);
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (until === 0) return source;

  const text = readStringAtPath(source, path);
  if (text === null || text.length !== start || (options && options.validate !== false)) {
    return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
  }
  return setPathValueImmutable(source, path, text + inserted);
}

function applyEncodedStringSpliceHistory(
  source: JsonValue,
  bytes: ArrayBuffer | ArrayBufferView,
  reader: HistoryReader,
  options?: PatchHistoryCodecOptions
): JsonValue {
  if (!options || options.validate !== false) {
    return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
  }

  const path = readPath(reader);
  const patchCount = reader.readVarint();
  const until = readHistoryUntil(options, patchCount);
  const starts = readUintListUntil(reader, patchCount, until);
  const deletes = readUintListUntil(reader, patchCount, until);
  const inserts = readStringDictionaryValuesUntil(reader, patchCount, until);
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (until === 0) return source;

  let text = readStringAtPath(source, path);
  if (text === null) {
    return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
  }

  let appendOnly = true;
  let cursor = text.length;
  for (let i = 0; i < until; i++) {
    if (deletes[i] !== 0 || starts[i] !== cursor) {
      appendOnly = false;
      break;
    }
    cursor += inserts[i].length;
  }

  if (appendOnly) {
    return setPathValueImmutable(source, path, text + inserts.join(''));
  }

  for (let i = 0; i < until; i++) {
    const start = starts[i];
    text = text.slice(0, start) + inserts[i] + text.slice(start + deletes[i]);
  }
  return setPathValueImmutable(source, path, text);
}

function applyEncodedSetColumnHistory(
  source: JsonValue,
  bytes: ArrayBuffer | ArrayBufferView,
  reader: HistoryReader,
  options?: PatchHistoryCodecOptions
): JsonValue {
  if (!options || options.validate !== false) {
    return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
  }

  const patchCount = reader.readVarint();
  const columnCount = reader.readVarint();
  const until = readHistoryUntil(options, patchCount);
  if (patchCount === 0 || columnCount === 0) {
    if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
    return source;
  }

  const paths = new Array<JsonPath>(columnCount);
  const values = new Array<JsonValue>(columnCount);
  for (let column = 0; column < columnCount; column++) {
    paths[column] = readPath(reader);
    if (until > 0) {
      values[column] = readValueColumnAt(reader, patchCount, until - 1);
    } else {
      skipValueColumn(reader, patchCount);
    }
  }

  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (until === 0) return source;

  let value = source;
  for (let column = 0; column < columnCount; column++) {
    value = setPathValueImmutable(value, paths[column], values[column]);
  }
  return value;
}

function applyEncodedAssignColumnHistory(
  source: JsonValue,
  bytes: ArrayBuffer | ArrayBufferView,
  reader: HistoryReader,
  options?: PatchHistoryCodecOptions
): JsonValue {
  if (!options || options.validate !== false) {
    return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
  }

  const patchCount = reader.readVarint();
  const assignCount = reader.readVarint();
  const until = readHistoryUntil(options, patchCount);
  if (patchCount === 0 || assignCount === 0) {
    if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
    return source;
  }

  const paths = new Array<JsonPath>(assignCount);
  const assigns = new Array<JsonObject>(assignCount);
  for (let assignIndex = 0; assignIndex < assignCount; assignIndex++) {
    paths[assignIndex] = readPath(reader);
    const keyCount = reader.readVarint();
    const keys = new Array<string>(keyCount);
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) keys[keyIndex] = reader.readString();

    const assign: JsonObject = {};
    for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
      if (until > 0) {
        setOwnValue(assign, keys[keyIndex], readValueColumnAt(reader, patchCount, until - 1));
      } else {
        skipValueColumn(reader, patchCount);
      }
    }
    assigns[assignIndex] = assign;
  }

  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (until === 0) return source;

  let value = source;
  for (let assignIndex = 0; assignIndex < assignCount; assignIndex++) {
    const nextValue = assignPathValuesImmutable(value, paths[assignIndex], assigns[assignIndex], false);
    if (nextValue === null) return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
    value = nextValue;
  }
  return value;
}

function applyEncodedRowFieldAssignHistory(
  source: JsonValue,
  bytes: ArrayBuffer | ArrayBufferView,
  reader: HistoryReader,
  options?: PatchHistoryCodecOptions
): JsonValue {
  if (!options || options.validate !== false) {
    return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
  }

  const patchCount = reader.readVarint();
  const basePath = readPath(reader);
  if (patchCount === 0) {
    return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
  }
  const until = readHistoryUntil(options, patchCount);
  const fieldCount = reader.readVarint();
  const fieldPaths = new Array<JsonPath>(fieldCount);
  for (let i = 0; i < fieldCount; i++) fieldPaths[i] = readPath(reader);

  const setColumnCount = reader.readVarint();
  const setPaths = new Array<JsonPath>(setColumnCount);
  for (let i = 0; i < setColumnCount; i++) setPaths[i] = readPath(reader);

  if (fieldCount === 1) {
    return applyEncodedSingleRowFieldAssignHistory(source, bytes, reader, options, patchCount, until, basePath, fieldPaths[0], setPaths);
  }

  if (fieldCount === 2) {
    return applyEncodedTwoRowFieldAssignHistory(
      source,
      bytes,
      reader,
      options,
      patchCount,
      until,
      basePath,
      fieldPaths[0],
      fieldPaths[1],
      setPaths
    );
  }

  const rowIndexes: number[] = [];
  const rowValues: Array<JsonValue[] | undefined> = [];
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    if (patchIndex >= until) {
      const skippedCount = skipIndexList(reader);
      skipValueList(reader, skippedCount * fieldCount);
      continue;
    }
    const indexes = readIndexList(reader);
    const values = readValueList(reader, indexes.length * fieldCount);
    for (let rowOffset = 0, rowCount = indexes.length; rowOffset < rowCount; rowOffset++) {
      const rowIndex = indexes[rowOffset];
      if (rowValues[rowIndex] === undefined) rowIndexes[rowIndexes.length] = rowIndex;
      const valueOffset = rowOffset * fieldCount;
      const row = new Array<JsonValue>(fieldCount);
      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex++) {
        row[fieldIndex] = values[valueOffset + fieldIndex];
      }
      rowValues[rowIndex] = row;
    }
  }

  const setValues = new Array<JsonValue>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    if (until > 0) {
      setValues[column] = readValueColumnAt(reader, patchCount, until - 1);
    } else {
      skipValueColumn(reader, patchCount);
    }
  }

  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');

  let value = source;
  if (rowIndexes.length !== 0) {
    const rowResult = applyRowFieldHistoryFinal(value, basePath, fieldPaths, rowIndexes, rowValues);
    if (rowResult === null) {
      return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
    }
    value = rowResult;
  }
  if (until === 0) return value;

  for (let column = 0; column < setColumnCount; column++) {
    value = setPathValueImmutable(value, setPaths[column], setValues[column]);
  }
  return value;
}

function applyEncodedSingleRowFieldAssignHistory(
  source: JsonValue,
  bytes: ArrayBuffer | ArrayBufferView,
  reader: HistoryReader,
  options: PatchHistoryCodecOptions | undefined,
  patchCount: number,
  until: number,
  basePath: JsonPath,
  fieldPath: JsonPath,
  setPaths: JsonPath[]
): JsonValue {
  const rowIndexes: number[] = [];
  const rowValues: JsonValue[] = [];
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    if (patchIndex >= until) {
      const skippedCount = skipIndexList(reader);
      skipValueList(reader, skippedCount);
      continue;
    }
    const indexes = readIndexList(reader);
    const values = readValueList(reader, indexes.length);
    for (let rowOffset = 0, rowCount = indexes.length; rowOffset < rowCount; rowOffset++) {
      const rowIndex = indexes[rowOffset];
      if (rowValues[rowIndex] === undefined) rowIndexes[rowIndexes.length] = rowIndex;
      rowValues[rowIndex] = values[rowOffset];
    }
  }

  const setColumnCount = setPaths.length;
  const setValues = new Array<JsonValue>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    if (until > 0) {
      setValues[column] = readValueColumnAt(reader, patchCount, until - 1);
    } else {
      skipValueColumn(reader, patchCount);
    }
  }

  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');

  let value = source;
  if (rowIndexes.length !== 0) {
    const rowResult = applySingleRowFieldHistoryFinal(value, basePath, fieldPath, rowIndexes, rowValues);
    if (rowResult === null) {
      return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
    }
    value = rowResult;
  }
  if (until === 0) return value;

  for (let column = 0; column < setColumnCount; column++) {
    value = setPathValueImmutable(value, setPaths[column], setValues[column]);
  }
  return value;
}

function applyEncodedTwoRowFieldAssignHistory(
  source: JsonValue,
  bytes: ArrayBuffer | ArrayBufferView,
  reader: HistoryReader,
  options: PatchHistoryCodecOptions | undefined,
  patchCount: number,
  until: number,
  basePath: JsonPath,
  fieldPath0: JsonPath,
  fieldPath1: JsonPath,
  setPaths: JsonPath[]
): JsonValue {
  const rowIndexes: number[] = [];
  const rowValues0: JsonValue[] = [];
  const rowValues1: JsonValue[] = [];
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    if (patchIndex >= until) {
      const skippedCount = skipIndexList(reader);
      skipValueList(reader, skippedCount * 2);
      continue;
    }
    const indexes = readIndexList(reader);
    readTwoRowFieldValuesInto(reader, indexes, rowIndexes, rowValues0, rowValues1);
  }

  const setColumnCount = setPaths.length;
  const setValues = new Array<JsonValue>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    if (until > 0) {
      setValues[column] = readValueColumnAt(reader, patchCount, until - 1);
    } else {
      skipValueColumn(reader, patchCount);
    }
  }

  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');

  let value = source;
  if (rowIndexes.length !== 0) {
    const rowResult = applyTwoRowFieldHistoryFinal(value, basePath, fieldPath0, fieldPath1, rowIndexes, rowValues0, rowValues1);
    if (rowResult === null) {
      return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
    }
    value = rowResult;
  }
  if (until === 0) return value;

  for (let column = 0; column < setColumnCount; column++) {
    value = setPathValueImmutable(value, setPaths[column], setValues[column]);
  }
  return value;
}

function readTwoRowFieldValuesInto(
  reader: HistoryReader,
  indexes: number[],
  rowIndexes: number[],
  rowValues0: JsonValue[],
  rowValues1: JsonValue[]
): void {
  const mode = reader.readByte();
  if (mode === VALUE_LIST_TWO_FIELD_SIGNED_INT_DELTA) {
    let value = 0;
    for (let rowOffset = 0, rowCount = indexes.length; rowOffset < rowCount; rowOffset++) {
      const rowIndex = indexes[rowOffset];
      if (rowValues0[rowIndex] === undefined) rowIndexes[rowIndexes.length] = rowIndex;
      value += reader.readSignedVarint();
      rowValues0[rowIndex] = value;
    }
    value = 0;
    for (let rowOffset = 0, rowCount = indexes.length; rowOffset < rowCount; rowOffset++) {
      value += reader.readSignedVarint();
      rowValues1[indexes[rowOffset]] = value;
    }
    return;
  }

  if (mode === VALUE_LIST_SIGNED_INT_DELTA) {
    let value = 0;
    for (let rowOffset = 0, rowCount = indexes.length; rowOffset < rowCount; rowOffset++) {
      const rowIndex = indexes[rowOffset];
      if (rowValues0[rowIndex] === undefined) rowIndexes[rowIndexes.length] = rowIndex;
      value += reader.readSignedVarint();
      rowValues0[rowIndex] = value;
      value += reader.readSignedVarint();
      rowValues1[rowIndex] = value;
    }
    return;
  }

  if (mode === VALUE_LIST_VALUES) {
    for (let rowOffset = 0, rowCount = indexes.length; rowOffset < rowCount; rowOffset++) {
      const rowIndex = indexes[rowOffset];
      if (rowValues0[rowIndex] === undefined) rowIndexes[rowIndexes.length] = rowIndex;
      rowValues0[rowIndex] = reader.readValue();
      rowValues1[rowIndex] = reader.readValue();
    }
    return;
  }

  throw new TypeError('invalid patch history value-list mode');
}

function applyRowFieldHistoryFinal(
  source: JsonValue,
  basePath: JsonPath,
  fieldPaths: JsonPath[],
  rowIndexes: number[],
  rowValues: Array<JsonValue[] | undefined>
): JsonValue | null {
  const cloned = cloneArrayAtPathImmutable(source, basePath);
  if (cloned === null) return null;
  const root = cloned[0];
  const rows = cloned[1];

  for (let i = 0, rowCount = rowIndexes.length; i < rowCount; i++) {
    const rowIndex = rowIndexes[i];
    const values = rowValues[rowIndex];
    if (values === undefined) continue;
    if (rowIndex < 0 || rowIndex >= rows.length) return null;

    const originalRow = rows[rowIndex];
    if (originalRow === null || typeof originalRow !== 'object') return null;
    const row = shallowCloneContainer(originalRow);
    rows[rowIndex] = row;
    for (let fieldIndex = 0, fieldCount = fieldPaths.length; fieldIndex < fieldCount; fieldIndex++) {
      if (!assignHistoryRelativeFieldImmutable(row, fieldPaths[fieldIndex], values[fieldIndex])) return null;
    }
  }

  return root;
}

function applyTwoRowFieldHistoryFinal(
  source: JsonValue,
  basePath: JsonPath,
  fieldPath0: JsonPath,
  fieldPath1: JsonPath,
  rowIndexes: number[],
  rowValues0: JsonValue[],
  rowValues1: JsonValue[]
): JsonValue | null {
  const cloned = cloneArrayAtPathImmutable(source, basePath);
  if (cloned === null) return null;
  const root = cloned[0];
  const rows = cloned[1];

  if (fieldPath0.length === 1 && fieldPath1.length === 1) {
    const field0 = fieldPath0[0];
    const field1 = fieldPath1[0];
    for (let i = 0, rowCount = rowIndexes.length; i < rowCount; i++) {
      const rowIndex = rowIndexes[i];
      if (rowIndex < 0 || rowIndex >= rows.length) return null;

      const originalRow = rows[rowIndex];
      if (originalRow === null || typeof originalRow !== 'object') return null;
      const row = shallowCloneContainer(originalRow);
      rows[rowIndex] = row;
      setOwnValue(row as JsonObject | JsonArray, field0, rowValues0[rowIndex]);
      setOwnValue(row as JsonObject | JsonArray, field1, rowValues1[rowIndex]);
    }
    return root;
  }

  for (let i = 0, rowCount = rowIndexes.length; i < rowCount; i++) {
    const rowIndex = rowIndexes[i];
    if (rowIndex < 0 || rowIndex >= rows.length) return null;

    const originalRow = rows[rowIndex];
    if (originalRow === null || typeof originalRow !== 'object') return null;
    const row = shallowCloneContainer(originalRow);
    rows[rowIndex] = row;
    if (!assignHistoryRelativeFieldImmutable(row, fieldPath0, rowValues0[rowIndex])) return null;
    if (!assignHistoryRelativeFieldImmutable(row, fieldPath1, rowValues1[rowIndex])) return null;
  }

  return root;
}

function applySingleRowFieldHistoryFinal(
  source: JsonValue,
  basePath: JsonPath,
  fieldPath: JsonPath,
  rowIndexes: number[],
  rowValues: JsonValue[]
): JsonValue | null {
  const cloned = cloneArrayAtPathImmutable(source, basePath);
  if (cloned === null) return null;
  const root = cloned[0];
  const rows = cloned[1];

  if (fieldPath.length === 1) {
    const field = fieldPath[0];
    for (let i = 0, rowCount = rowIndexes.length; i < rowCount; i++) {
      const rowIndex = rowIndexes[i];
      if (rowIndex < 0 || rowIndex >= rows.length) return null;

      const originalRow = rows[rowIndex];
      if (originalRow === null || typeof originalRow !== 'object') return null;
      const row = shallowCloneContainer(originalRow);
      rows[rowIndex] = row;
      setOwnValue(row as JsonObject | JsonArray, field, rowValues[rowIndex]);
    }
    return root;
  }

  for (let i = 0, rowCount = rowIndexes.length; i < rowCount; i++) {
    const rowIndex = rowIndexes[i];
    if (rowIndex < 0 || rowIndex >= rows.length) return null;

    const originalRow = rows[rowIndex];
    if (originalRow === null || typeof originalRow !== 'object') return null;
    const row = shallowCloneContainer(originalRow);
    rows[rowIndex] = row;
    if (!assignHistoryRelativeFieldImmutable(row, fieldPath, rowValues[rowIndex])) return null;
  }

  return root;
}

function cloneArrayAtPathImmutable(source: JsonValue, path: JsonPath): [JsonValue, JsonArray] | null {
  if (path.length === 0) {
    if (!Array.isArray(source)) return null;
    const root = source.slice();
    return [root, root];
  }

  if (source === null || typeof source !== 'object') return null;
  const root = shallowCloneContainer(source);
  let originalNode = source as JsonObject | JsonArray;
  let clonedNode = root as JsonObject | JsonArray;
  for (let i = 0, last = path.length - 1; i < last; i++) {
    const key = path[i];
    const nextOriginal = originalNode[key];
    if (nextOriginal === null || typeof nextOriginal !== 'object') return null;
    const child = shallowCloneContainer(nextOriginal);
    setOwnValue(clonedNode, key, child);
    originalNode = nextOriginal as JsonObject | JsonArray;
    clonedNode = child as JsonObject | JsonArray;
  }

  const key = path[path.length - 1];
  const array = originalNode[key];
  if (!Array.isArray(array)) return null;
  const clonedArray = array.slice();
  setOwnValue(clonedNode, key, clonedArray);
  return [root, clonedArray];
}

function assignHistoryRelativeFieldImmutable(row: JsonValue, field: JsonPath, value: JsonValue): boolean {
  if (field.length === 0) return false;
  let parent = row as JsonObject | JsonArray;
  for (let i = 0, last = field.length - 1; i < last; i++) {
    const key = field[i];
    const nextOriginal = parent[key];
    if (nextOriginal === null || typeof nextOriginal !== 'object') return false;
    const child = shallowCloneContainer(nextOriginal);
    setOwnValue(parent, key, child);
    parent = child as JsonObject | JsonArray;
  }
  setOwnValue(parent, field[field.length - 1], value);
  return true;
}

function tryEncodeStringSpliceHistory(patches: Patch[]): Uint8Array | null {
  const patchCount = patches.length;
  if (patchCount < 8) return null;
  const first = patches[0];
  if (first.length !== 1 || first[0][0] !== OP_STRING_SPLICE) return null;
  const firstOp = first[0];
  const path = firstOp[1];
  const starts = new Array<number>(patchCount);
  const deletes = new Array<number>(patchCount);
  const inserts = new Array<string>(patchCount);
  starts[0] = firstOp[2];
  deletes[0] = firstOp[3];
  inserts[0] = firstOp[4];

  for (let i = 1; i < patchCount; i++) {
    const patch = patches[i];
    if (patch.length !== 1 || patch[0][0] !== OP_STRING_SPLICE) return null;
    const op = patch[0];
    if (!samePath(op[1], path)) return null;
    starts[i] = op[2];
    deletes[i] = op[3];
    inserts[i] = op[4];
  }

  const writer = createHistoryWriter(HISTORY_MODE_STRING_SPLICE);
  writePath(writer, path);
  writer.writeVarint(patchCount);
  writeUintList(writer, starts);
  writeUintList(writer, deletes);
  writeStringDictionaryValues(writer, inserts);
  return writer.finish();
}

function decodeStringSpliceHistory(reader: HistoryReader, options?: PatchHistoryCodecOptions): Patch[] {
  const path = readPath(reader);
  const patchCount = reader.readVarint();
  const starts = readUintList(reader, patchCount);
  const deletes = readUintList(reader, patchCount);
  const inserts = readStringDictionaryValues(reader, patchCount);
  const patches = new Array<Patch>(patchCount);
  for (let i = 0; i < patchCount; i++) {
    patches[i] = [[OP_STRING_SPLICE, path.slice(), starts[i], deletes[i], inserts[i]]];
  }
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (!options || options.validate !== false) {
    for (let i = 0; i < patches.length; i++) assertPatch(patches[i]);
  }
  return patches;
}

function tryEncodeRowFieldAssignHistory(patches: Patch[]): Uint8Array | null {
  const patchCount = patches.length;
  if (patchCount < 8) return null;
  const firstPatch = patches[0];
  if (firstPatch.length === 0 || firstPatch[0][0] !== OP_ARRAY_OBJECT_FIELD_ASSIGN) return null;
  const firstRowOp = firstPatch[0];
  const basePath = firstRowOp[1];
  const fieldPaths = firstRowOp[3];
  if (fieldPaths.length === 0) return null;

  const setColumnCount = firstPatch.length - 1;
  const setPaths = new Array<JsonPath>(setColumnCount);
  const setValues = new Array<JsonValue[]>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    const op = firstPatch[column + 1];
    if (op[0] !== OP_SET) return null;
    setPaths[column] = op[1];
    const values = new Array<JsonValue>(patchCount);
    values[0] = op[2];
    setValues[column] = values;
  }

  for (let i = 1; i < patchCount; i++) {
    const patch = patches[i];
    if (patch.length !== firstPatch.length || patch[0][0] !== OP_ARRAY_OBJECT_FIELD_ASSIGN) return null;
    const rowOp = patch[0];
    if (!samePath(rowOp[1], basePath) || !samePathList(rowOp[3], fieldPaths)) return null;
    if (rowOp[4].length !== rowOp[2].length * fieldPaths.length) return null;
    for (let column = 0; column < setColumnCount; column++) {
      const op = patch[column + 1];
      if (op[0] !== OP_SET || !samePath(op[1], setPaths[column])) return null;
      setValues[column][i] = op[2];
    }
  }

  if (firstRowOp[4].length !== firstRowOp[2].length * fieldPaths.length) return null;

  const writer = createHistoryWriter(HISTORY_MODE_ROW_FIELD_ASSIGN);
  writer.writeVarint(patchCount);
  writePath(writer, basePath);
  writer.writeVarint(fieldPaths.length);
  for (let i = 0, length = fieldPaths.length; i < length; i++) writePath(writer, fieldPaths[i]);
  writer.writeVarint(setColumnCount);
  for (let i = 0; i < setColumnCount; i++) writePath(writer, setPaths[i]);
  for (let i = 0; i < patchCount; i++) {
    const rowOp = patches[i][0] as [typeof OP_ARRAY_OBJECT_FIELD_ASSIGN, JsonPath, number[], JsonPath[], JsonValue[]];
    writeIndexList(writer, rowOp[2]);
    writeValueList(writer, rowOp[4]);
  }
  for (let column = 0; column < setColumnCount; column++) writeValueColumn(writer, setValues[column]);
  return writer.finish();
}

function decodeRowFieldAssignHistory(reader: HistoryReader, options?: PatchHistoryCodecOptions): Patch[] {
  const patchCount = reader.readVarint();
  const basePath = readPath(reader);
  const fieldCount = reader.readVarint();
  const fieldPaths = new Array<JsonPath>(fieldCount);
  for (let i = 0; i < fieldCount; i++) fieldPaths[i] = readPath(reader);
  const setColumnCount = reader.readVarint();
  const setPaths = new Array<JsonPath>(setColumnCount);
  for (let i = 0; i < setColumnCount; i++) setPaths[i] = readPath(reader);

  const indexesByPatch = new Array<number[]>(patchCount);
  const valuesByPatch = new Array<JsonValue[]>(patchCount);
  for (let i = 0; i < patchCount; i++) {
    const indexes = readIndexList(reader);
    indexesByPatch[i] = indexes;
    valuesByPatch[i] = readValueList(reader, indexes.length * fieldCount);
  }

  const setColumns = new Array<JsonValue[]>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    setColumns[column] = readValueColumn(reader, patchCount);
  }

  const patches = new Array<Patch>(patchCount);
  for (let i = 0; i < patchCount; i++) {
    const patch = new Array<PatchOperation>(1 + setColumnCount);
    const fields = copyPathList(fieldPaths);
    patch[0] = [OP_ARRAY_OBJECT_FIELD_ASSIGN, basePath.slice(), indexesByPatch[i], fields, valuesByPatch[i]];
    for (let column = 0; column < setColumnCount; column++) {
      patch[column + 1] = [OP_SET, setPaths[column].slice(), setColumns[column][i]];
    }
    patches[i] = patch;
  }
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (!options || options.validate !== false) {
    for (let i = 0; i < patches.length; i++) assertPatch(patches[i]);
  }
  return patches;
}

function readAssignKeys(assign: JsonValue): string[] | null {
  if (assign === null || typeof assign !== 'object' || Array.isArray(assign)) return null;
  const keys = Object.keys(assign);
  return keys.length === 0 ? null : keys;
}

function hasAssignKeys(assign: JsonValue, keys: string[]): boolean {
  if (assign === null || typeof assign !== 'object' || Array.isArray(assign)) return false;
  const assignKeys = Object.keys(assign);
  if (assignKeys.length !== keys.length) return false;
  for (let i = 0, length = keys.length; i < length; i++) {
    if (!objectHasOwn.call(assign, keys[i])) return false;
  }
  return true;
}

function getUniformAssignKeys(assigns: JsonObject[]): string[] | null {
  if (assigns.length === 0) return null;
  const first = assigns[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return null;
  const keys = Object.keys(first);
  if (keys.length === 0) return null;
  return hasUniformAssignKeys(assigns, keys) ? keys : null;
}

function hasUniformAssignKeys(assigns: JsonObject[], keys: string[]): boolean {
  for (let i = 0, assignCount = assigns.length; i < assignCount; i++) {
    const assign = assigns[i];
    if (assign === null || typeof assign !== 'object' || Array.isArray(assign)) return false;
    const assignKeys = Object.keys(assign);
    if (assignKeys.length !== keys.length) return false;
    for (let keyIndex = 0, keyCount = keys.length; keyIndex < keyCount; keyIndex++) {
      if (!Object.prototype.hasOwnProperty.call(assign, keys[keyIndex])) return false;
    }
  }
  return true;
}

function flattenAssignValues(assigns: JsonObject[], keys: string[]): JsonValue[] {
  const values = new Array<JsonValue>(assigns.length * keys.length);
  let cursor = 0;
  for (let i = 0, assignCount = assigns.length; i < assignCount; i++) {
    const assign = assigns[i];
    for (let keyIndex = 0, keyCount = keys.length; keyIndex < keyCount; keyIndex++) {
      values[cursor++] = assign[keys[keyIndex]];
    }
  }
  return values;
}

function inflateAssignValues(keys: string[], values: JsonValue[]): JsonObject[] {
  if (keys.length === 0) return [];
  if (values.length % keys.length !== 0) throw new TypeError('invalid row object assign history values');
  const assigns = new Array<JsonObject>(values.length / keys.length);
  let cursor = 0;
  for (let i = 0, assignCount = assigns.length; i < assignCount; i++) {
    const assign: JsonObject = {};
    for (let keyIndex = 0, keyCount = keys.length; keyIndex < keyCount; keyIndex++) {
      setOwnValue(assign, keys[keyIndex], values[cursor++]);
    }
    assigns[i] = assign;
  }
  return assigns;
}

function tryEncodeTwoFieldIntegerRowObjectAssignHistory(patches: Patch[]): Uint8Array | null {
  const patchCount = patches.length;
  if (patchCount < 8) return null;
  const firstPatch = patches[0];
  if (firstPatch.length === 0 || firstPatch[0][0] !== OP_ARRAY_OBJECT_ASSIGN) return null;
  const firstRowOp = firstPatch[0];
  const basePath = firstRowOp[1];
  const firstAssign = firstRowOp[3][0];
  if (firstAssign === null || typeof firstAssign !== 'object' || Array.isArray(firstAssign)) return null;
  const keys = Object.keys(firstAssign);
  if (keys.length !== 2 || firstRowOp[2].length !== firstRowOp[3].length) return null;
  const firstKey = keys[0];
  const secondKey = keys[1];

  const setColumnCount = firstPatch.length - 1;
  const setPaths = new Array<JsonPath>(setColumnCount);
  const setValues = new Array<JsonValue[]>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    const op = firstPatch[column + 1];
    if (op[0] !== OP_SET) return null;
    setPaths[column] = op[1];
    const values = new Array<JsonValue>(patchCount);
    values[0] = op[2];
    setValues[column] = values;
  }

  const writer = createHistoryWriter(HISTORY_MODE_ROW_OBJECT_ASSIGN);
  writer.writeVarint(patchCount);
  writePath(writer, basePath);
  writer.writeVarint(2);
  writer.writeString(firstKey);
  writer.writeString(secondKey);
  writer.writeVarint(setColumnCount);
  for (let i = 0; i < setColumnCount; i++) writePath(writer, setPaths[i]);

  writeIndexList(writer, firstRowOp[2]);
  if (!tryWriteExactTwoFieldIntegerAssignValues(writer, firstRowOp[3], firstKey, secondKey)) return null;

  for (let i = 1; i < patchCount; i++) {
    const patch = patches[i];
    if (patch.length !== firstPatch.length || patch[0][0] !== OP_ARRAY_OBJECT_ASSIGN) return null;
    const rowOp = patch[0];
    if (!samePath(rowOp[1], basePath) || rowOp[2].length !== rowOp[3].length) return null;
    for (let column = 0; column < setColumnCount; column++) {
      const op = patch[column + 1];
      if (op[0] !== OP_SET || !samePath(op[1], setPaths[column])) return null;
      setValues[column][i] = op[2];
    }
    writeIndexList(writer, rowOp[2]);
    if (!tryWriteExactTwoFieldIntegerAssignValues(writer, rowOp[3], firstKey, secondKey)) return null;
  }

  for (let column = 0; column < setColumnCount; column++) writeValueColumn(writer, setValues[column]);
  return writer.finish();
}

function tryWriteExactTwoFieldIntegerAssignValues(writer: HistoryWriter, assigns: JsonObject[], firstKey: string, secondKey: string): boolean {
  const startOffset = writer.offset;
  writer.writeByte(VALUE_LIST_TWO_FIELD_SIGNED_INT_DELTA);
  const firstValues = new Array<number>(assigns.length);
  const secondValues = new Array<number>(assigns.length);
  for (let i = 0, assignCount = assigns.length; i < assignCount; i++) {
    const assign = assigns[i];
    if (assign === null || typeof assign !== 'object' || Array.isArray(assign)) {
      writer.offset = startOffset;
      return false;
    }
    if (!objectHasOwn.call(assign, firstKey) || !objectHasOwn.call(assign, secondKey)) {
      writer.offset = startOffset;
      return false;
    }

    let keyCount = 0;
    for (const key in assign) {
      if (!objectHasOwn.call(assign, key)) continue;
      if (key !== firstKey && key !== secondKey) {
        writer.offset = startOffset;
        return false;
      }
      keyCount++;
    }
    if (keyCount !== 2) {
      writer.offset = startOffset;
      return false;
    }

    const firstValue = assign[firstKey];
    if (typeof firstValue !== 'number' || !Number.isSafeInteger(firstValue) || Object.is(firstValue, -0)) {
      writer.offset = startOffset;
      return false;
    }
    firstValues[i] = firstValue;

    const secondValue = assign[secondKey];
    if (typeof secondValue !== 'number' || !Number.isSafeInteger(secondValue) || Object.is(secondValue, -0)) {
      writer.offset = startOffset;
      return false;
    }
    secondValues[i] = secondValue;
  }
  writeSignedIntegerDeltas(writer, firstValues);
  writeSignedIntegerDeltas(writer, secondValues);
  return true;
}

function tryEncodeRowObjectAssignHistory(patches: Patch[]): Uint8Array | null {
  const patchCount = patches.length;
  if (patchCount < 8) return null;
  const firstPatch = patches[0];
  if (firstPatch.length === 0 || firstPatch[0][0] !== OP_ARRAY_OBJECT_ASSIGN) return null;
  const firstRowOp = firstPatch[0];
  const basePath = firstRowOp[1];
  const keys = getUniformAssignKeys(firstRowOp[3]);
  if (keys === null) return null;
  const fieldCount = keys.length;

  const setColumnCount = firstPatch.length - 1;
  const setPaths = new Array<JsonPath>(setColumnCount);
  const setValues = new Array<JsonValue[]>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    const op = firstPatch[column + 1];
    if (op[0] !== OP_SET) return null;
    setPaths[column] = op[1];
    const values = new Array<JsonValue>(patchCount);
    values[0] = op[2];
    setValues[column] = values;
  }

  for (let i = 1; i < patchCount; i++) {
    const patch = patches[i];
    if (patch.length !== firstPatch.length || patch[0][0] !== OP_ARRAY_OBJECT_ASSIGN) return null;
    const rowOp = patch[0];
    if (!samePath(rowOp[1], basePath) || rowOp[2].length !== rowOp[3].length || !hasUniformAssignKeys(rowOp[3], keys)) return null;
    for (let column = 0; column < setColumnCount; column++) {
      const op = patch[column + 1];
      if (op[0] !== OP_SET || !samePath(op[1], setPaths[column])) return null;
      setValues[column][i] = op[2];
    }
  }

  if (firstRowOp[2].length !== firstRowOp[3].length) return null;

  const writer = createHistoryWriter(HISTORY_MODE_ROW_OBJECT_ASSIGN);
  writer.writeVarint(patchCount);
  writePath(writer, basePath);
  writer.writeVarint(fieldCount);
  for (let field = 0; field < fieldCount; field++) writer.writeString(keys[field]);
  writer.writeVarint(setColumnCount);
  for (let i = 0; i < setColumnCount; i++) writePath(writer, setPaths[i]);
  for (let i = 0; i < patchCount; i++) {
    const rowOp = patches[i][0] as [typeof OP_ARRAY_OBJECT_ASSIGN, JsonPath, number[], JsonObject[]];
    writeIndexList(writer, rowOp[2]);
    if (fieldCount !== 2 || !tryWriteTwoFieldIntegerAssignValues(writer, rowOp[3], keys[0], keys[1])) {
      writeValueList(writer, flattenAssignValues(rowOp[3], keys));
    }
  }
  for (let column = 0; column < setColumnCount; column++) writeValueColumn(writer, setValues[column]);
  return writer.finish();
}

function tryWriteTwoFieldIntegerAssignValues(writer: HistoryWriter, assigns: JsonObject[], firstKey: string, secondKey: string): boolean {
  const startOffset = writer.offset;
  writer.writeByte(VALUE_LIST_TWO_FIELD_SIGNED_INT_DELTA);
  const firstValues = new Array<number>(assigns.length);
  const secondValues = new Array<number>(assigns.length);
  for (let i = 0, assignCount = assigns.length; i < assignCount; i++) {
    const assign = assigns[i];
    const firstValue = assign[firstKey];
    if (typeof firstValue !== 'number' || !Number.isSafeInteger(firstValue) || Object.is(firstValue, -0)) {
      writer.offset = startOffset;
      return false;
    }
    firstValues[i] = firstValue;

    const secondValue = assign[secondKey];
    if (typeof secondValue !== 'number' || !Number.isSafeInteger(secondValue) || Object.is(secondValue, -0)) {
      writer.offset = startOffset;
      return false;
    }
    secondValues[i] = secondValue;
  }
  writeSignedIntegerDeltas(writer, firstValues);
  writeSignedIntegerDeltas(writer, secondValues);
  return true;
}

function decodeRowObjectAssignHistory(reader: HistoryReader, options?: PatchHistoryCodecOptions): Patch[] {
  const patchCount = reader.readVarint();
  const basePath = readPath(reader);
  const fieldCount = reader.readVarint();
  const keys = new Array<string>(fieldCount);
  for (let i = 0; i < fieldCount; i++) keys[i] = reader.readString();
  const setColumnCount = reader.readVarint();
  const setPaths = new Array<JsonPath>(setColumnCount);
  for (let i = 0; i < setColumnCount; i++) setPaths[i] = readPath(reader);

  const indexesByPatch = new Array<number[]>(patchCount);
  const assignsByPatch = new Array<JsonObject[]>(patchCount);
  for (let i = 0; i < patchCount; i++) {
    const indexes = readIndexList(reader);
    indexesByPatch[i] = indexes;
    assignsByPatch[i] = inflateAssignValues(keys, readValueList(reader, indexes.length * fieldCount));
  }

  const setColumns = new Array<JsonValue[]>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    setColumns[column] = readValueColumn(reader, patchCount);
  }

  const patches = new Array<Patch>(patchCount);
  for (let i = 0; i < patchCount; i++) {
    const patch = new Array<PatchOperation>(1 + setColumnCount);
    patch[0] = [OP_ARRAY_OBJECT_ASSIGN, basePath.slice(), indexesByPatch[i], assignsByPatch[i]];
    for (let column = 0; column < setColumnCount; column++) {
      patch[column + 1] = [OP_SET, setPaths[column].slice(), setColumns[column][i]];
    }
    patches[i] = patch;
  }
  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');
  if (!options || options.validate !== false) {
    for (let i = 0; i < patches.length; i++) assertPatch(patches[i]);
  }
  return patches;
}

function applyEncodedRowObjectAssignHistory(
  source: JsonValue,
  bytes: ArrayBuffer | ArrayBufferView,
  reader: HistoryReader,
  options?: PatchHistoryCodecOptions
): JsonValue {
  if (!options || options.validate !== false) {
    return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
  }

  const patchCount = reader.readVarint();
  const basePath = readPath(reader);
  if (patchCount === 0) return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
  const until = readHistoryUntil(options, patchCount);

  const fieldCount = reader.readVarint();
  const fieldPaths = new Array<JsonPath>(fieldCount);
  for (let field = 0; field < fieldCount; field++) fieldPaths[field] = [reader.readString()];

  const setColumnCount = reader.readVarint();
  const setPaths = new Array<JsonPath>(setColumnCount);
  for (let i = 0; i < setColumnCount; i++) setPaths[i] = readPath(reader);

  if (fieldCount === 1) {
    return applyEncodedSingleRowFieldAssignHistory(source, bytes, reader, options, patchCount, until, basePath, fieldPaths[0], setPaths);
  }

  if (fieldCount === 2) {
    return applyEncodedTwoRowFieldAssignHistory(
      source,
      bytes,
      reader,
      options,
      patchCount,
      until,
      basePath,
      fieldPaths[0],
      fieldPaths[1],
      setPaths
    );
  }

  const rowIndexes: number[] = [];
  const rowValues: Array<JsonValue[] | undefined> = [];
  for (let patchIndex = 0; patchIndex < patchCount; patchIndex++) {
    if (patchIndex >= until) {
      const skippedCount = skipIndexList(reader);
      skipValueList(reader, skippedCount * fieldCount);
      continue;
    }
    const indexes = readIndexList(reader);
    const values = readValueList(reader, indexes.length * fieldCount);
    for (let rowOffset = 0, rowCount = indexes.length; rowOffset < rowCount; rowOffset++) {
      const rowIndex = indexes[rowOffset];
      if (rowValues[rowIndex] === undefined) rowIndexes[rowIndexes.length] = rowIndex;
      const valueOffset = rowOffset * fieldCount;
      const row = new Array<JsonValue>(fieldCount);
      for (let field = 0; field < fieldCount; field++) row[field] = values[valueOffset + field];
      rowValues[rowIndex] = row;
    }
  }

  const setValues = new Array<JsonValue>(setColumnCount);
  for (let column = 0; column < setColumnCount; column++) {
    if (until > 0) {
      setValues[column] = readValueColumnAt(reader, patchCount, until - 1);
    } else {
      skipValueColumn(reader, patchCount);
    }
  }

  if (reader.offset !== reader.bytes.length) throw new TypeError('unexpected trailing binary patch history data');

  let value = source;
  if (rowIndexes.length !== 0) {
    const rowResult = applyRowFieldHistoryFinal(value, basePath, fieldPaths, rowIndexes, rowValues);
    if (rowResult === null) return applyPatchHistory(source, decodePatchHistory(bytes, options), options);
    value = rowResult;
  }
  if (until === 0) return value;
  for (let column = 0; column < setColumnCount; column++) {
    value = setPathValueImmutable(value, setPaths[column], setValues[column]);
  }
  return value;
}

function createHistoryWriter(mode: number): HistoryWriter {
  const writer = new HistoryWriter();
  writer.writeByte(HISTORY_MAGIC_0);
  writer.writeByte(HISTORY_MAGIC_1);
  writer.writeByte(HISTORY_MAGIC_2);
  writer.writeByte(HISTORY_VERSION);
  writer.writeByte(mode);
  return writer;
}

function writeHistoryOperation(writer: HistoryWriter, pathMap: Map<string, number>, op: PatchOperation): void {
  const code = op[0];
  writer.writeByte(code);
  writer.writeVarint(readPathId(pathMap, op[1]));

  if (code === OP_SET || code === OP_APPEND || code === OP_ASSIGN || code === OP_SCALAR_ARRAY_REPLACE) {
    writer.writeValue(op[2]);
  } else if (code === OP_REMOVE) {
    return;
  } else if (code === OP_TRUNCATE) {
    writer.writeVarint(op[2]);
  } else if (code === OP_STRING_SPLICE) {
    writer.writeVarint(op[2]);
    writer.writeVarint(op[3]);
    writer.writeString(op[4]);
  } else if (code === OP_ARRAY_SPLICE) {
    writer.writeVarint(op[2]);
    writer.writeVarint(op[3]);
    writer.writeValue(op[4]);
  } else if (code === OP_ARRAY_TWO_FIELD_INSERT) {
    writer.writeVarint(op[2]);
    writer.writeString(op[3]);
    writer.writeString(op[4]);
    writer.writeValue(op[5]);
    writer.writeValue(op[6]);
  } else if (code === OP_ARRAY_MOVE) {
    writer.writeVarint(op[2]);
    writer.writeVarint(op[3]);
  } else if (code === OP_STRING_COPY) {
    writer.writeVarint(op[2]);
    writer.writeVarint(op[3]);
    writer.writeVarint(op[4]);
  } else if (code === OP_ARRAY_ASSIGN || code === OP_ARRAY_OBJECT_ASSIGN) {
    writeIndexList(writer, op[2]);
    writer.writeValue(op[3]);
  } else if (code === OP_ARRAY_TUPLE_ASSIGN) {
    writeIndexList(writer, op[2]);
    writeIndexList(writer, op[3]);
    writer.writeValue(op[4]);
  } else if (code === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
    writeIndexList(writer, op[2]);
    const fields = op[3];
    writer.writeVarint(fields.length);
    for (let i = 0, length = fields.length; i < length; i++) {
      writer.writeVarint(readPathId(pathMap, fields[i]));
    }
    writer.writeValue(op[4]);
  } else {
    throw new TypeError('invalid patch history operation code');
  }
}

function readHistoryOperation(reader: HistoryReader, paths: JsonPath[]): PatchOperation {
  const code = reader.readByte();
  const path = readPathRef(reader, paths);
  if (code === OP_SET) return [OP_SET, path, reader.readValue() as JsonValue];
  if (code === OP_REMOVE) return [OP_REMOVE, path];
  if (code === OP_TRUNCATE) return [OP_TRUNCATE, path, reader.readVarint()];
  if (code === OP_APPEND) return [OP_APPEND, path, reader.readValue() as JsonValue[]];
  if (code === OP_SCALAR_ARRAY_REPLACE) return [OP_SCALAR_ARRAY_REPLACE, path, reader.readValue() as JsonPrimitive[]];
  if (code === OP_ASSIGN) return [OP_ASSIGN, path, reader.readValue() as JsonObject];
  if (code === OP_STRING_SPLICE) {
    return [OP_STRING_SPLICE, path, reader.readVarint(), reader.readVarint(), reader.readString()];
  }
  if (code === OP_ARRAY_SPLICE) {
    return [OP_ARRAY_SPLICE, path, reader.readVarint(), reader.readVarint(), reader.readValue() as JsonValue[]];
  }
  if (code === OP_ARRAY_TWO_FIELD_INSERT) {
    return [
      OP_ARRAY_TWO_FIELD_INSERT,
      path,
      reader.readVarint(),
      reader.readString(),
      reader.readString(),
      reader.readValue() as JsonPrimitive[],
      reader.readValue() as JsonPrimitive[]
    ];
  }
  if (code === OP_ARRAY_MOVE) return [OP_ARRAY_MOVE, path, reader.readVarint(), reader.readVarint()];
  if (code === OP_STRING_COPY) {
    return [OP_STRING_COPY, path, reader.readVarint(), reader.readVarint(), reader.readVarint()];
  }
  if (code === OP_ARRAY_ASSIGN) return [OP_ARRAY_ASSIGN, path, readIndexList(reader), reader.readValue() as JsonValue[]];
  if (code === OP_ARRAY_OBJECT_ASSIGN) {
    return [OP_ARRAY_OBJECT_ASSIGN, path, readIndexList(reader), reader.readValue() as JsonObject[]];
  }
  if (code === OP_ARRAY_TUPLE_ASSIGN) {
    return [OP_ARRAY_TUPLE_ASSIGN, path, readIndexList(reader), readIndexList(reader), reader.readValue() as JsonValue[]];
  }
  if (code === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
    const indexes = readIndexList(reader);
    const fieldCount = reader.readVarint();
    const fields = new Array<JsonPath>(fieldCount);
    for (let i = 0; i < fieldCount; i++) fields[i] = readPathRef(reader, paths);
    return [OP_ARRAY_OBJECT_FIELD_ASSIGN, path, indexes, fields, reader.readValue() as JsonValue[]];
  }
  throw new TypeError('invalid patch history operation code');
}

function skipHistoryOperation(reader: HistoryReader, paths: JsonPath[]): void {
  const code = reader.readByte();
  skipPathRef(reader, paths);
  if (code === OP_SET || code === OP_APPEND || code === OP_SCALAR_ARRAY_REPLACE || code === OP_ASSIGN) {
    reader.skipValue();
    return;
  }
  if (code === OP_REMOVE) return;
  if (code === OP_TRUNCATE) {
    reader.readVarint();
    return;
  }
  if (code === OP_STRING_SPLICE) {
    reader.readVarint();
    reader.readVarint();
    reader.skipString();
    return;
  }
  if (code === OP_ARRAY_SPLICE) {
    reader.readVarint();
    reader.readVarint();
    reader.skipValue();
    return;
  }
  if (code === OP_ARRAY_TWO_FIELD_INSERT) {
    reader.readVarint();
    reader.skipString();
    reader.skipString();
    reader.skipValue();
    reader.skipValue();
    return;
  }
  if (code === OP_ARRAY_MOVE) {
    reader.readVarint();
    reader.readVarint();
    return;
  }
  if (code === OP_STRING_COPY) {
    reader.readVarint();
    reader.readVarint();
    reader.readVarint();
    return;
  }
  if (code === OP_ARRAY_ASSIGN || code === OP_ARRAY_OBJECT_ASSIGN) {
    skipIndexList(reader);
    reader.skipValue();
    return;
  }
  if (code === OP_ARRAY_TUPLE_ASSIGN) {
    skipIndexList(reader);
    skipIndexList(reader);
    reader.skipValue();
    return;
  }
  if (code === OP_ARRAY_OBJECT_FIELD_ASSIGN) {
    skipIndexList(reader);
    const fieldCount = reader.readVarint();
    for (let i = 0; i < fieldCount; i++) skipPathRef(reader, paths);
    reader.skipValue();
    return;
  }
  throw new TypeError('invalid patch history operation code');
}

function internPath(pathMap: Map<string, number>, paths: JsonPath[], path: JsonPath): number {
  const key = pathKey(path);
  const existing = pathMap.get(key);
  if (existing !== undefined) return existing;
  const id = paths.length;
  pathMap.set(key, id);
  paths[id] = path.slice();
  return id;
}

function readPathId(pathMap: Map<string, number>, path: JsonPath): number {
  const id = pathMap.get(pathKey(path));
  if (id === undefined) throw new TypeError('patch history path was not interned');
  return id;
}

function pathKey(path: JsonPath): string {
  return JSON.stringify(path);
}

function writePath(writer: HistoryWriter, path: JsonPath): void {
  writer.writeVarint(path.length);
  for (let i = 0, length = path.length; i < length; i++) {
    const segment = path[i];
    if (typeof segment === 'number') {
      writer.writeByte(SEGMENT_NUMBER);
      writer.writeVarint(segment);
    } else {
      writer.writeByte(SEGMENT_STRING);
      writer.writeString(segment);
    }
  }
}

function readPath(reader: HistoryReader): JsonPath {
  const length = reader.readVarint();
  const path = new Array(length);
  for (let i = 0; i < length; i++) {
    const tag = reader.readByte();
    if (tag === SEGMENT_NUMBER) {
      path[i] = reader.readVarint();
    } else if (tag === SEGMENT_STRING) {
      path[i] = reader.readString();
    } else {
      throw new TypeError('invalid patch history path segment tag');
    }
  }
  return path;
}

function readPathRef(reader: HistoryReader, paths: JsonPath[]): JsonPath {
  const path = paths[reader.readVarint()];
  if (path === undefined) throw new TypeError('invalid patch history path reference');
  return path.slice();
}

function skipPathRef(reader: HistoryReader, paths: JsonPath[]): void {
  if (paths[reader.readVarint()] === undefined) throw new TypeError('invalid patch history path reference');
}

function samePath(left: JsonPath, right: JsonPath): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0, length = left.length; i < length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function samePathList(left: JsonPath[], right: JsonPath[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0, length = left.length; i < length; i++) {
    if (!samePath(left[i], right[i])) return false;
  }
  return true;
}

function copyPathList(paths: JsonPath[]): JsonPath[] {
  const out = new Array<JsonPath>(paths.length);
  for (let i = 0, length = paths.length; i < length; i++) out[i] = paths[i].slice();
  return out;
}

function writeValueColumn(writer: HistoryWriter, values: JsonValue[]): void {
  const length = values.length;
  if (length > 0) {
    const first = values[0];
    let constant = true;
    for (let i = 1; i < length; i++) {
      if (values[i] !== first) {
        constant = false;
        break;
      }
    }
    if (constant) {
      writer.writeByte(COLUMN_CONST);
      writer.writeValue(first);
      return;
    }

    if (typeof first === 'number' && Number.isSafeInteger(first) && !Object.is(first, -0)) {
      const second = values[1];
      if (typeof second === 'number' && Number.isSafeInteger(second) && !Object.is(second, -0)) {
        const step = second - first;
        let arithmetic = true;
        for (let i = 2; i < length; i++) {
          if (values[i] !== first + step * i) {
            arithmetic = false;
            break;
          }
        }
        if (arithmetic) {
          writer.writeByte(COLUMN_INT_ARITHMETIC);
          writer.writeSignedVarint(first);
          writer.writeSignedVarint(step);
          return;
        }
      }
    }
  }

  writer.writeByte(COLUMN_VALUES);
  for (let i = 0; i < length; i++) writer.writeValue(values[i]);
}

function readValueColumn(reader: HistoryReader, length: number): JsonValue[] {
  const mode = reader.readByte();
  const values = new Array<JsonValue>(length);
  if (mode === COLUMN_CONST) {
    const value = reader.readValue();
    for (let i = 0; i < length; i++) values[i] = value;
    return values;
  }
  if (mode === COLUMN_INT_ARITHMETIC) {
    let value = reader.readSignedVarint();
    const step = reader.readSignedVarint();
    for (let i = 0; i < length; i++, value += step) values[i] = value;
    return values;
  }
  if (mode === COLUMN_VALUES) {
    for (let i = 0; i < length; i++) values[i] = reader.readValue();
    return values;
  }
  throw new TypeError('invalid patch history value-column mode');
}

function readValueColumnAt(reader: HistoryReader, length: number, index: number): JsonValue {
  const mode = reader.readByte();
  if (mode === COLUMN_CONST) {
    return reader.readValue();
  }
  if (mode === COLUMN_INT_ARITHMETIC) {
    const first = reader.readSignedVarint();
    const step = reader.readSignedVarint();
    return first + step * index;
  }
  if (mode === COLUMN_VALUES) {
    let value: JsonValue = null;
    for (let i = 0; i < length; i++) {
      const next = reader.readValue();
      if (i === index) value = next;
    }
    return value;
  }
  throw new TypeError('invalid patch history value-column mode');
}

function skipValueColumn(reader: HistoryReader, length: number): void {
  const mode = reader.readByte();
  if (mode === COLUMN_CONST) {
    reader.skipValue();
    return;
  }
  if (mode === COLUMN_INT_ARITHMETIC) {
    reader.readSignedVarint();
    reader.readSignedVarint();
    return;
  }
  if (mode === COLUMN_VALUES) {
    for (let i = 0; i < length; i++) reader.skipValue();
    return;
  }
  throw new TypeError('invalid patch history value-column mode');
}

function writeValueList(writer: HistoryWriter, values: JsonValue[]): void {
  const length = values.length;
  if (length > 0 && areSafeIntegerValues(values)) {
    writer.writeByte(VALUE_LIST_SIGNED_INT_DELTA);
    writeSignedIntegerDeltas(writer, values as number[]);
    return;
  }

  writer.writeByte(VALUE_LIST_VALUES);
  for (let i = 0; i < length; i++) writer.writeValue(values[i]);
}

function writeSignedIntegerDeltas(writer: HistoryWriter, values: number[]): void {
  let previous = 0;
  for (let i = 0, length = values.length; i < length; i++) {
    const value = values[i];
    writer.writeSignedVarint(i === 0 ? value : value - previous);
    previous = value;
  }
}

function readValueList(reader: HistoryReader, length: number): JsonValue[] {
  const mode = reader.readByte();
  const values = new Array<JsonValue>(length);
  if (mode === VALUE_LIST_TWO_FIELD_SIGNED_INT_DELTA) {
    if ((length & 1) !== 0) throw new TypeError('invalid two-field patch history value-list length');
    const rowCount = length >> 1;
    let value = 0;
    for (let i = 0; i < rowCount; i++) {
      value += reader.readSignedVarint();
      values[i * 2] = value;
    }
    value = 0;
    for (let i = 0; i < rowCount; i++) {
      value += reader.readSignedVarint();
      values[i * 2 + 1] = value;
    }
    return values;
  }
  if (mode === VALUE_LIST_SIGNED_INT_DELTA) {
    let value = 0;
    for (let i = 0; i < length; i++) {
      value += reader.readSignedVarint();
      values[i] = value;
    }
    return values;
  }
  if (mode === VALUE_LIST_VALUES) {
    for (let i = 0; i < length; i++) values[i] = reader.readValue();
    return values;
  }
  throw new TypeError('invalid patch history value-list mode');
}

function skipValueList(reader: HistoryReader, length: number): void {
  const mode = reader.readByte();
  if (mode === VALUE_LIST_TWO_FIELD_SIGNED_INT_DELTA) {
    for (let i = 0; i < length; i++) reader.readSignedVarint();
    return;
  }
  if (mode === VALUE_LIST_SIGNED_INT_DELTA) {
    for (let i = 0; i < length; i++) reader.readSignedVarint();
    return;
  }
  if (mode === VALUE_LIST_VALUES) {
    for (let i = 0; i < length; i++) reader.skipValue();
    return;
  }
  throw new TypeError('invalid patch history value-list mode');
}

function areSafeIntegerValues(values: JsonValue[]): boolean {
  for (let i = 0, length = values.length; i < length; i++) {
    const value = values[i];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0)) return false;
  }
  return true;
}

function writeUintList(writer: HistoryWriter, values: number[]): void {
  const length = values.length;
  if (length >= 8) {
    const period = findPeriodicUintListLength(values);
    if (period > 0 && period < length) {
      writer.writeByte(UINT_LIST_PERIODIC);
      writer.writeVarint(period);
      for (let i = 0; i < period; i++) writer.writeVarint(values[i]);
      return;
    }
  }

  if (length >= 2) {
    const first = values[0];
    const step = values[1] - first;
    let arithmetic = true;
    for (let i = 2; i < length; i++) {
      if (values[i] !== first + step * i) {
        arithmetic = false;
        break;
      }
    }
    if (arithmetic && step >= 0) {
      writer.writeByte(UINT_LIST_ARITHMETIC);
      writer.writeVarint(first);
      writer.writeVarint(step);
      return;
    }
  }

  if (isSortedAscending(values)) {
    writer.writeByte(UINT_LIST_DELTA);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const value = values[i];
      writer.writeVarint(i === 0 ? value : value - previous);
      previous = value;
    }
    return;
  }

  writer.writeByte(UINT_LIST_RAW);
  for (let i = 0; i < length; i++) writer.writeVarint(values[i]);
}

function readUintList(reader: HistoryReader, length: number): number[] {
  const mode = reader.readByte();
  const values = new Array<number>(length);
  if (mode === UINT_LIST_ARITHMETIC) {
    let value = reader.readVarint();
    const step = reader.readVarint();
    for (let i = 0; i < length; i++, value += step) values[i] = value;
    return values;
  }
  if (mode === UINT_LIST_DELTA) {
    let value = 0;
    for (let i = 0; i < length; i++) {
      value += reader.readVarint();
      values[i] = value;
    }
    return values;
  }
  if (mode === UINT_LIST_PERIODIC) {
    const period = reader.readVarint();
    if (period === 0 || period > length) throw new TypeError('invalid patch history periodic uint-list length');
    for (let i = 0; i < period; i++) values[i] = reader.readVarint();
    for (let i = period; i < length; i++) values[i] = values[i % period];
    return values;
  }
  if (mode === UINT_LIST_RAW) {
    for (let i = 0; i < length; i++) values[i] = reader.readVarint();
    return values;
  }
  throw new TypeError('invalid patch history uint-list mode');
}

function readUintListUntil(reader: HistoryReader, length: number, until: number): number[] {
  const mode = reader.readByte();
  const clipped = until > length ? length : until;
  const values = new Array<number>(clipped);
  if (mode === UINT_LIST_ARITHMETIC) {
    const first = reader.readVarint();
    const step = reader.readVarint();
    for (let i = 0; i < clipped; i++) values[i] = first + step * i;
    return values;
  }
  if (mode === UINT_LIST_DELTA) {
    let value = 0;
    for (let i = 0; i < length; i++) {
      value += reader.readVarint();
      if (i < clipped) values[i] = value;
    }
    return values;
  }
  if (mode === UINT_LIST_PERIODIC) {
    const period = reader.readVarint();
    if (period === 0 || period > length) throw new TypeError('invalid patch history periodic uint-list length');
    const periodValues = new Array<number>(period);
    for (let i = 0; i < period; i++) periodValues[i] = reader.readVarint();
    for (let i = 0; i < clipped; i++) values[i] = periodValues[i % period];
    return values;
  }
  if (mode === UINT_LIST_RAW) {
    for (let i = 0; i < length; i++) {
      const value = reader.readVarint();
      if (i < clipped) values[i] = value;
    }
    return values;
  }
  throw new TypeError('invalid patch history uint-list mode');
}

function writeStringDictionaryValues(writer: HistoryWriter, values: string[]): void {
  const dictionary = [];
  const indexes = new Map<string, number>();
  const ids = new Array<number>(values.length);
  for (let i = 0, length = values.length; i < length; i++) {
    const value = values[i];
    let id = indexes.get(value);
    if (id === undefined) {
      id = dictionary.length;
      dictionary[id] = value;
      indexes.set(value, id);
    }
    ids[i] = id;
  }

  writeStringDictionaryIds(writer, dictionary, ids);
}

function writeStringDictionaryIds(writer: HistoryWriter, dictionary: string[], ids: number[]): void {
  writer.writeVarint(dictionary.length);
  for (let i = 0, length = dictionary.length; i < length; i++) writer.writeString(dictionary[i]);
  writeUintList(writer, ids);
}

function readStringDictionaryValues(reader: HistoryReader, length: number): string[] {
  const dictionaryLength = reader.readVarint();
  const dictionary = new Array<string>(dictionaryLength);
  for (let i = 0; i < dictionaryLength; i++) dictionary[i] = reader.readString();
  const ids = readUintList(reader, length);
  const values = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    const value = dictionary[ids[i]];
    if (value === undefined) throw new TypeError('invalid patch history string dictionary reference');
    values[i] = value;
  }
  return values;
}

function readStringDictionaryValuesUntil(reader: HistoryReader, length: number, until: number): string[] {
  const dictionaryLength = reader.readVarint();
  const dictionary = new Array<string>(dictionaryLength);
  for (let i = 0; i < dictionaryLength; i++) dictionary[i] = reader.readString();
  const clipped = until > length ? length : until;
  const ids = readUintListUntil(reader, length, clipped);
  const values = new Array<string>(clipped);
  for (let i = 0; i < clipped; i++) {
    const value = dictionary[ids[i]];
    if (value === undefined) throw new TypeError('invalid patch history string dictionary reference');
    values[i] = value;
  }
  return values;
}

function readStringDictionaryJoinedUntil(reader: HistoryReader, length: number, until: number): string {
  const dictionaryLength = reader.readVarint();
  const dictionary = new Array<string>(dictionaryLength);
  for (let i = 0; i < dictionaryLength; i++) dictionary[i] = reader.readString();

  const mode = reader.readByte();
  if (mode === UINT_LIST_PERIODIC) {
    const period = reader.readVarint();
    if (period === 0 || period > length) throw new TypeError('invalid patch history periodic uint-list length');
    const periodValues = new Array<string>(period);
    for (let i = 0; i < period; i++) periodValues[i] = readStringDictionaryEntry(dictionary, reader.readVarint());
    const repeated = periodValues.join('');
    const repeats = Math.floor(until / period);
    const remainder = until - repeats * period;
    return repeated.repeat(repeats) + (remainder === 0 ? '' : periodValues.slice(0, remainder).join(''));
  }

  const values = new Array<string>(until);
  if (mode === UINT_LIST_ARITHMETIC) {
    let id = reader.readVarint();
    const step = reader.readVarint();
    for (let i = 0; i < length; i++, id += step) {
      if (i < until) values[i] = readStringDictionaryEntry(dictionary, id);
    }
    return values.join('');
  }
  if (mode === UINT_LIST_DELTA) {
    let id = 0;
    for (let i = 0; i < length; i++) {
      id += reader.readVarint();
      if (i < until) values[i] = readStringDictionaryEntry(dictionary, id);
    }
    return values.join('');
  }
  if (mode === UINT_LIST_RAW) {
    for (let i = 0; i < length; i++) {
      const id = reader.readVarint();
      if (i < until) values[i] = readStringDictionaryEntry(dictionary, id);
    }
    return values.join('');
  }
  throw new TypeError('invalid patch history uint-list mode');
}

function readStringDictionaryEntry(dictionary: string[], id: number): string {
  const value = dictionary[id];
  if (value === undefined) throw new TypeError('invalid patch history string dictionary reference');
  return value;
}

function writeIndexList(writer: HistoryWriter, indexes: number[]): void {
  const length = indexes.length;
  if (length >= 4 && isConsecutiveRun(indexes)) {
    writer.writeByte(INDEX_RUN);
    writer.writeVarint(indexes[0]);
    writer.writeVarint(length);
    return;
  }

  if (length >= 8 && isStrictSortedUintIndexes(indexes) && indexes[length - 1] < 64) {
    writer.writeByte(INDEX_U64_BITMAP);
    writeUint64IndexBitmap(writer, indexes);
    return;
  }

  if (length >= 4 && isSortedAscending(indexes)) {
    writer.writeByte(INDEX_DELTA);
    writer.writeVarint(length);
    let previous = 0;
    for (let i = 0; i < length; i++) {
      const value = indexes[i];
      writer.writeVarint(i === 0 ? value : value - previous);
      previous = value;
    }
    return;
  }

  writer.writeByte(INDEX_RAW);
  writer.writeVarint(length);
  for (let i = 0; i < length; i++) writer.writeVarint(indexes[i]);
}

function readIndexList(reader: HistoryReader): number[] {
  const mode = reader.readByte();
  if (mode === INDEX_RUN) {
    const start = reader.readVarint();
    const length = reader.readVarint();
    const indexes = new Array<number>(length);
    for (let i = 0; i < length; i++) indexes[i] = start + i;
    return indexes;
  }
  if (mode === INDEX_U64_BITMAP) {
    return readUint64IndexBitmap(reader);
  }

  const length = reader.readVarint();
  const indexes = new Array<number>(length);
  if (mode === INDEX_DELTA) {
    let value = 0;
    for (let i = 0; i < length; i++) {
      value += reader.readVarint();
      indexes[i] = value;
    }
    return indexes;
  }
  if (mode === INDEX_RAW) {
    for (let i = 0; i < length; i++) indexes[i] = reader.readVarint();
    return indexes;
  }
  throw new TypeError('invalid patch history index-list mode');
}

function skipIndexList(reader: HistoryReader): number {
  const mode = reader.readByte();
  if (mode === INDEX_RUN) {
    reader.readVarint();
    return reader.readVarint();
  }
  if (mode === INDEX_U64_BITMAP) {
    let count = 0;
    for (let i = 0; i < 8; i++) count += BYTE_POPCOUNT[reader.readByte()];
    return count;
  }

  const length = reader.readVarint();
  if (mode === INDEX_DELTA || mode === INDEX_RAW) {
    for (let i = 0; i < length; i++) reader.readVarint();
    return length;
  }
  throw new TypeError('invalid patch history index-list mode');
}

function writeUint64IndexBitmap(writer: HistoryWriter, indexes: number[]): void {
  let cursor = 0;
  for (let byteIndex = 0; byteIndex < 8; byteIndex++) {
    const end = (byteIndex + 1) << 3;
    let value = 0;
    while (cursor < indexes.length && indexes[cursor] < end) {
      value |= 1 << (indexes[cursor] & 7);
      cursor++;
    }
    writer.writeByte(value);
  }
}

function readUint64IndexBitmap(reader: HistoryReader): number[] {
  const byte0 = reader.readByte();
  const byte1 = reader.readByte();
  const byte2 = reader.readByte();
  const byte3 = reader.readByte();
  const byte4 = reader.readByte();
  const byte5 = reader.readByte();
  const byte6 = reader.readByte();
  const byte7 = reader.readByte();
  const indexes = new Array<number>(
    BYTE_POPCOUNT[byte0] +
    BYTE_POPCOUNT[byte1] +
    BYTE_POPCOUNT[byte2] +
    BYTE_POPCOUNT[byte3] +
    BYTE_POPCOUNT[byte4] +
    BYTE_POPCOUNT[byte5] +
    BYTE_POPCOUNT[byte6] +
    BYTE_POPCOUNT[byte7]
  );
  let cursor = 0;
  cursor = appendByteIndexes(indexes, cursor, byte0, 0);
  cursor = appendByteIndexes(indexes, cursor, byte1, 8);
  cursor = appendByteIndexes(indexes, cursor, byte2, 16);
  cursor = appendByteIndexes(indexes, cursor, byte3, 24);
  cursor = appendByteIndexes(indexes, cursor, byte4, 32);
  cursor = appendByteIndexes(indexes, cursor, byte5, 40);
  cursor = appendByteIndexes(indexes, cursor, byte6, 48);
  appendByteIndexes(indexes, cursor, byte7, 56);
  return indexes;
}

function appendByteIndexes(out: number[], cursor: number, value: number, base: number): number {
  const offsets = BYTE_INDEXES[value];
  for (let i = 0, length = offsets.length; i < length; i++) out[cursor++] = base + offsets[i];
  return cursor;
}

function createBytePopcountTable(): Uint8Array {
  const table = new Uint8Array(256);
  for (let i = 1; i < 256; i++) table[i] = table[i >>> 1] + (i & 1);
  return table;
}

function createByteIndexTable(): number[][] {
  const table = new Array<number[]>(256);
  for (let value = 0; value < 256; value++) {
    const indexes: number[] = [];
    for (let bit = 0; bit < 8; bit++) {
      if ((value & (1 << bit)) !== 0) indexes[indexes.length] = bit;
    }
    table[value] = indexes;
  }
  return table;
}

function isConsecutiveRun(indexes: number[]): boolean {
  for (let i = 1, length = indexes.length; i < length; i++) {
    if (indexes[i] !== indexes[i - 1] + 1) return false;
  }
  return true;
}

function isSortedAscending(indexes: number[]): boolean {
  for (let i = 1, length = indexes.length; i < length; i++) {
    if (indexes[i] < indexes[i - 1]) return false;
  }
  return true;
}

function isStrictSortedUintIndexes(indexes: number[]): boolean {
  if (indexes.length === 0 || indexes[0] < 0 || !Number.isSafeInteger(indexes[0])) return false;
  for (let i = 1, length = indexes.length; i < length; i++) {
    const index = indexes[i];
    if (!Number.isSafeInteger(index) || index <= indexes[i - 1]) return false;
  }
  return true;
}

function findPeriodicUintListLength(values: number[]): number {
  const length = values.length;
  const maxPeriod = Math.min(64, length >> 1);
  for (let period = 1; period <= maxPeriod; period++) {
    let periodic = true;
    for (let i = period; i < length; i++) {
      if (values[i] !== values[i % period]) {
        periodic = false;
        break;
      }
    }
    if (periodic) return period;
  }
  return 0;
}

class HistoryWriter {
  bytes = new Uint8Array(256);
  view = new DataView(this.bytes.buffer);
  offset = 0;

  finish(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }

  ensure(size: number): void {
    const needed = this.offset + size;
    if (needed <= this.bytes.length) return;
    let nextLength = this.bytes.length << 1;
    while (nextLength < needed) nextLength <<= 1;
    const next = new Uint8Array(nextLength);
    next.set(this.bytes);
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  writeByte(value: number): void {
    this.ensure(1);
    this.bytes[this.offset++] = value;
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.bytes.set(bytes, this.offset);
    this.offset += bytes.length;
  }

  writeVarint(value: number): void {
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

  writeSignedVarint(value: number): void {
    this.writeVarint(value < 0 ? (-value * 2) - 1 : value * 2);
  }

  writeDouble(value: number): void {
    this.ensure(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }

  writeString(value: string): void {
    const bytes = textEncoder.encode(value);
    this.writeVarint(bytes.length);
    this.writeBytes(bytes);
  }

  writeValue(value: JsonValue): void {
    if (value === null) {
      this.writeByte(VALUE_NULL);
      return;
    }
    if (value === false) {
      this.writeByte(VALUE_FALSE);
      return;
    }
    if (value === true) {
      this.writeByte(VALUE_TRUE);
      return;
    }

    const type = typeof value;
    if (type === 'number') {
      const numberValue = value as number;
      if (Number.isSafeInteger(numberValue) && !Object.is(numberValue, -0)) {
        this.writeByte(VALUE_INT);
        this.writeSignedVarint(numberValue);
      } else {
        this.writeByte(VALUE_DOUBLE);
        this.writeDouble(numberValue);
      }
      return;
    }
    if (type === 'string') {
      this.writeByte(VALUE_STRING);
      this.writeString(value as string);
      return;
    }
    if (Array.isArray(value)) {
      this.writeByte(VALUE_ARRAY);
      this.writeVarint(value.length);
      for (let i = 0, length = value.length; i < length; i++) this.writeValue(value[i]);
      return;
    }

    this.writeByte(VALUE_OBJECT);
    const keys = Object.keys(value);
    this.writeVarint(keys.length);
    for (let i = 0, length = keys.length; i < length; i++) {
      const key = keys[i];
      this.writeString(key);
      this.writeValue(value[key]);
    }
  }
}

class HistoryReader {
  bytes: Uint8Array;
  view: DataView;
  offset = 0;

  constructor(value: ArrayBuffer | ArrayBufferView) {
    if (value instanceof Uint8Array) {
      this.bytes = value;
    } else if (value instanceof ArrayBuffer) {
      this.bytes = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      this.bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      throw new TypeError('binary patch history data must be an ArrayBuffer or typed array');
    }
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  readByte(): number {
    if (this.offset >= this.bytes.length) throw new TypeError('unexpected end of binary patch history data');
    return this.bytes[this.offset++];
  }

  readVarint(): number {
    let value = 0;
    let multiplier = 1;
    for (;;) {
      const byte = this.readByte();
      value += (byte & 0x7f) * multiplier;
      if (byte < 0x80) return value;
      multiplier *= 0x80;
      if (multiplier > Number.MAX_SAFE_INTEGER) {
        throw new TypeError('binary patch history varint exceeds safe integer range');
      }
    }
  }

  readSignedVarint(): number {
    const value = this.readVarint();
    return value % 2 === 1 ? -((value + 1) / 2) : value / 2;
  }

  readDouble(): number {
    if (this.offset + 8 > this.bytes.length) throw new TypeError('unexpected end of binary patch history data');
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readString(): string {
    const length = this.readVarint();
    const end = this.offset + length;
    if (end > this.bytes.length) throw new TypeError('unexpected end of binary patch history data');
    const value = textDecoder.decode(this.bytes.subarray(this.offset, end));
    this.offset = end;
    return value;
  }

  skipString(): void {
    const length = this.readVarint();
    const end = this.offset + length;
    if (end > this.bytes.length) throw new TypeError('unexpected end of binary patch history data');
    this.offset = end;
  }

  readValue(): JsonValue {
    const tag = this.readByte();
    if (tag === VALUE_NULL) return null;
    if (tag === VALUE_FALSE) return false;
    if (tag === VALUE_TRUE) return true;
    if (tag === VALUE_INT) return this.readSignedVarint();
    if (tag === VALUE_DOUBLE) return this.readDouble();
    if (tag === VALUE_STRING) return this.readString();
    if (tag === VALUE_ARRAY) {
      const length = this.readVarint();
      const array = new Array<JsonValue>(length);
      for (let i = 0; i < length; i++) array[i] = this.readValue();
      return array;
    }
    if (tag === VALUE_OBJECT) {
      const length = this.readVarint();
      const object: JsonObject = {};
      for (let i = 0; i < length; i++) {
        setOwnValue(object, this.readString(), this.readValue());
      }
      return object;
    }
    throw new TypeError('invalid patch history value tag');
  }

  skipValue(): void {
    const tag = this.readByte();
    if (tag === VALUE_NULL || tag === VALUE_FALSE || tag === VALUE_TRUE) return;
    if (tag === VALUE_INT) {
      this.readSignedVarint();
      return;
    }
    if (tag === VALUE_DOUBLE) {
      this.readDouble();
      return;
    }
    if (tag === VALUE_STRING) {
      this.skipString();
      return;
    }
    if (tag === VALUE_ARRAY) {
      const length = this.readVarint();
      for (let i = 0; i < length; i++) this.skipValue();
      return;
    }
    if (tag === VALUE_OBJECT) {
      const length = this.readVarint();
      for (let i = 0; i < length; i++) {
        this.skipString();
        this.skipValue();
      }
      return;
    }
    throw new TypeError('invalid patch history value tag');
  }
}
