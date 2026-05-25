import { encodeCanonicalJson, stringifyCanonicalJson } from './canonical.js';
import { decodePatch, encodePatch } from './codec.js';
import { decodePatchHistory, encodePatchHistory } from './history.js';
import { assertJsonValue } from '@shapeshift-labs/frontier/validate';
import type { CodecOptions, JsonObject, JsonValue, Patch, PatchHistoryCodecOptions } from './types.js';

export type CodecFrameKind = 'patch' | 'patch-history';

export interface CodecSchemaIdOptions {
  maxDepth?: number;
}

export interface CodecFrameEncodeOptions extends CodecOptions {
  schemaId?: string;
  schema?: JsonValue;
  metadata?: JsonObject;
}

export interface CodecHistoryFrameEncodeOptions extends PatchHistoryCodecOptions {
  schemaId?: string;
  schema?: JsonValue;
  metadata?: JsonObject;
}

export interface CodecFrameInspectOptions {
  maxMetadataBytes?: number;
}

export interface CodecFrameDecodeOptions extends CodecOptions, CodecFrameInspectOptions {
  expectedSchemaId?: string;
}

export interface CodecHistoryFrameDecodeOptions extends PatchHistoryCodecOptions, CodecFrameInspectOptions {
  expectedSchemaId?: string;
}

export interface CodecFrameHeader {
  version: 1;
  kind: CodecFrameKind;
  contentType: string;
  flags: number;
  schemaId?: string;
  metadata?: JsonObject;
  payloadOffset: number;
  payloadLength: number;
  byteLength: number;
}

const FRAME_MAGIC_0 = 0x66; // f
const FRAME_MAGIC_1 = 0x72; // r
const FRAME_MAGIC_2 = 0x66; // f
const FRAME_VERSION = 1;
const FRAME_KIND_PATCH = 1;
const FRAME_KIND_PATCH_HISTORY = 2;
const FRAME_FLAGS_NONE = 0;
const DEFAULT_MAX_METADATA_BYTES = 64 * 1024;
const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function createCodecSchemaId(schema: JsonValue, options?: CodecSchemaIdOptions): string {
  const bytes = encodeCanonicalJson(schema, options);
  let hash = FNV64_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return 'fnv1a64:' + hash.toString(16).padStart(16, '0');
}

export function encodePatchFrame(patch: Patch, options?: CodecFrameEncodeOptions): Uint8Array {
  return encodeCodecFrame('patch', encodePatch(patch, options), options);
}

export function decodePatchFrame(bytes: ArrayBuffer | ArrayBufferView, options?: CodecFrameDecodeOptions): Patch {
  const header = inspectCodecFrame(bytes, options);
  if (header.kind !== 'patch') throw new TypeError('codec frame does not contain a patch payload');
  assertExpectedSchemaId(header, options);
  return decodePatch(readCodecFramePayload(bytes, header), options);
}

export function encodePatchHistoryFrame(
  patches: Patch[],
  options?: CodecHistoryFrameEncodeOptions
): Uint8Array {
  return encodeCodecFrame('patch-history', encodePatchHistory(patches, options), options);
}

export function decodePatchHistoryFrame(
  bytes: ArrayBuffer | ArrayBufferView,
  options?: CodecHistoryFrameDecodeOptions
): Patch[] {
  const header = inspectCodecFrame(bytes, options);
  if (header.kind !== 'patch-history') throw new TypeError('codec frame does not contain a patch-history payload');
  assertExpectedSchemaId(header, options);
  return decodePatchHistory(readCodecFramePayload(bytes, header), options);
}

export function inspectCodecFrame(
  bytes: ArrayBuffer | ArrayBufferView,
  options?: CodecFrameInspectOptions
): CodecFrameHeader {
  const input = binaryBytes(bytes);
  if (
    input.length < 6 ||
    input[0] !== FRAME_MAGIC_0 ||
    input[1] !== FRAME_MAGIC_1 ||
    input[2] !== FRAME_MAGIC_2
  ) {
    throw new TypeError('invalid codec frame header');
  }
  if (input[3] !== FRAME_VERSION) throw new TypeError('unsupported codec frame version');
  const kind = readFrameKind(input[4]);
  const flags = input[5];
  if (flags !== FRAME_FLAGS_NONE) throw new TypeError('unsupported codec frame flags');

  const schemaIdRead = readVarint(input, 6);
  const metadataRead = readVarint(input, schemaIdRead.offset);
  const payloadRead = readVarint(input, metadataRead.offset);
  const schemaIdLength = schemaIdRead.value;
  const metadataLength = metadataRead.value;
  const payloadLength = payloadRead.value;
  const maxMetadataBytes = options && options.maxMetadataBytes !== undefined
    ? readMaxMetadataBytes(options.maxMetadataBytes)
    : DEFAULT_MAX_METADATA_BYTES;
  if (metadataLength > maxMetadataBytes) throw new TypeError('codec frame metadata exceeds maxMetadataBytes');

  let offset = payloadRead.offset;
  const schemaIdOffset = offset;
  offset = checkedAdd(offset, schemaIdLength, input.length);
  const metadataOffset = offset;
  offset = checkedAdd(offset, metadataLength, input.length);
  const payloadOffset = offset;
  const endOffset = checkedAdd(offset, payloadLength, input.length);
  if (endOffset !== input.length) throw new TypeError('unexpected trailing codec frame data');

  const schemaId = schemaIdLength === 0 ? undefined : textDecoder.decode(input.subarray(schemaIdOffset, schemaIdOffset + schemaIdLength));
  const metadata = metadataLength === 0
    ? undefined
    : JSON.parse(textDecoder.decode(input.subarray(metadataOffset, metadataOffset + metadataLength)));
  if (metadata !== undefined) {
    assertJsonValue(metadata, 'codec frame metadata');
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new TypeError('codec frame metadata must be a JSON object');
    }
  }

  return {
    version: 1,
    kind,
    contentType: kind === 'patch'
      ? 'application/vnd.shapeshift.frontier.patch+binary'
      : 'application/vnd.shapeshift.frontier.patch-history+binary',
    flags,
    schemaId,
    metadata: metadata as JsonObject | undefined,
    payloadOffset,
    payloadLength,
    byteLength: input.length
  };
}

export function readCodecFramePayload(
  bytes: ArrayBuffer | ArrayBufferView,
  header?: CodecFrameHeader
): Uint8Array {
  const input = binaryBytes(bytes);
  const frame = header || inspectCodecFrame(input);
  return input.subarray(frame.payloadOffset, frame.payloadOffset + frame.payloadLength);
}

function encodeCodecFrame(
  kind: CodecFrameKind,
  payload: Uint8Array,
  options: CodecFrameEncodeOptions | CodecHistoryFrameEncodeOptions | undefined
): Uint8Array {
  const schemaId = readFrameSchemaId(options);
  const schemaIdBytes = schemaId === undefined ? new Uint8Array(0) : textEncoder.encode(schemaId);
  const metadataBytes = options && options.metadata !== undefined
    ? encodeFrameMetadata(options.metadata)
    : new Uint8Array(0);
  const payloadBytes = binaryBytes(payload);
  const headerLength =
    6 +
    varintByteLength(schemaIdBytes.length) +
    varintByteLength(metadataBytes.length) +
    varintByteLength(payloadBytes.length);
  const out = new Uint8Array(headerLength + schemaIdBytes.length + metadataBytes.length + payloadBytes.length);
  out[0] = FRAME_MAGIC_0;
  out[1] = FRAME_MAGIC_1;
  out[2] = FRAME_MAGIC_2;
  out[3] = FRAME_VERSION;
  out[4] = kind === 'patch' ? FRAME_KIND_PATCH : FRAME_KIND_PATCH_HISTORY;
  out[5] = FRAME_FLAGS_NONE;
  let offset = writeVarint(out, 6, schemaIdBytes.length);
  offset = writeVarint(out, offset, metadataBytes.length);
  offset = writeVarint(out, offset, payloadBytes.length);
  out.set(schemaIdBytes, offset);
  offset += schemaIdBytes.length;
  out.set(metadataBytes, offset);
  offset += metadataBytes.length;
  out.set(payloadBytes, offset);
  return out;
}

function encodeFrameMetadata(metadata: JsonObject): Uint8Array {
  assertJsonValue(metadata, 'codec frame metadata');
  return textEncoder.encode(stringifyCanonicalJson(metadata));
}

function readFrameSchemaId(options: CodecFrameEncodeOptions | CodecHistoryFrameEncodeOptions | undefined): string | undefined {
  if (!options) return undefined;
  if (options.schemaId !== undefined) {
    if (typeof options.schemaId !== 'string' || options.schemaId.length === 0) {
      throw new TypeError('codec frame schemaId must be a non-empty string');
    }
    return options.schemaId;
  }
  if (options.schema !== undefined) return createCodecSchemaId(options.schema);
  return undefined;
}

function assertExpectedSchemaId(
  header: CodecFrameHeader,
  options: CodecFrameDecodeOptions | CodecHistoryFrameDecodeOptions | undefined
): void {
  if (options && options.expectedSchemaId !== undefined && header.schemaId !== options.expectedSchemaId) {
    throw new TypeError('codec frame schemaId mismatch');
  }
}

function readFrameKind(value: number): CodecFrameKind {
  if (value === FRAME_KIND_PATCH) return 'patch';
  if (value === FRAME_KIND_PATCH_HISTORY) return 'patch-history';
  throw new TypeError('unknown codec frame kind');
}

function binaryBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('codec frame data must be an ArrayBuffer or typed array');
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0;
  let multiplier = 1;
  for (let i = offset; i < bytes.length; i++) {
    const byte = bytes[i];
    value += (byte & 0x7f) * multiplier;
    if (value > Number.MAX_SAFE_INTEGER) throw new TypeError('codec frame varint exceeds safe integer range');
    if (byte < 0x80) return { value, offset: i + 1 };
    multiplier *= 0x80;
    if (multiplier > Number.MAX_SAFE_INTEGER) throw new TypeError('codec frame varint exceeds safe integer range');
  }
  throw new TypeError('truncated codec frame varint');
}

function writeVarint(bytes: Uint8Array, offset: number, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('codec frame varint must be a non-negative safe integer');
  while (value >= 0x80) {
    bytes[offset++] = (value % 0x80) | 0x80;
    value = Math.floor(value / 0x80);
  }
  bytes[offset++] = value;
  return offset;
}

function varintByteLength(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('codec frame length must be a non-negative safe integer');
  let length = 1;
  while (value >= 0x80) {
    length++;
    value = Math.floor(value / 0x80);
  }
  return length;
}

function checkedAdd(offset: number, length: number, limit: number): number {
  const next = offset + length;
  if (!Number.isSafeInteger(next) || next > limit) throw new TypeError('truncated codec frame data');
  return next;
}

function readMaxMetadataBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('maxMetadataBytes option must be a non-negative safe integer');
  return value;
}
