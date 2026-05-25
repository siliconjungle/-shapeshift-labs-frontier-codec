import { setOwnValue } from './object.js';
import type { JsonObject, JsonPath, JsonValue } from './types.js';

export const binaryTextEncoder = new TextEncoder();
export const binaryTextDecoder = new TextDecoder();

export class BinaryByteWriter {
  bytes: Uint8Array;
  view: DataView;
  offset = 0;

  constructor(initialSize = 256) {
    this.bytes = new Uint8Array(initialSize);
    this.view = new DataView(this.bytes.buffer);
  }

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
    this.bytes[this.offset++] = value & 0xff;
  }

  writeBytes(values: Uint8Array): void {
    this.ensure(values.length);
    this.bytes.set(values, this.offset);
    this.offset += values.length;
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

  writeFloat64(value: number): void {
    this.ensure(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
  }

  writeDouble(value: number): void {
    this.writeFloat64(value);
  }

  writeUtf8StringPayload(value: string): void {
    const bytes = binaryTextEncoder.encode(value);
    this.writeVarint(bytes.length);
    this.writeBytes(bytes);
  }

  writeVarintAt(offset: number, value: number): number {
    const start = offset;
    while (value >= 0x80) {
      this.bytes[offset++] = (value % 0x80) | 0x80;
      value = Math.floor(value / 0x80);
    }
    this.bytes[offset++] = value;
    return offset - start;
  }

  reserveFixedVarint(): number {
    const offset = this.offset;
    for (let i = 0; i < 5; i++) this.writeByte(0);
    return offset;
  }

  patchFixedVarint(offset: number, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0x7ffffffff) {
      throw new TypeError('binary fixed varint must be a non-negative 35-bit integer');
    }
    const encoded: number[] = [];
    while (value >= 128) {
      encoded[encoded.length] = (value % 128) | 128;
      value = Math.floor(value / 128);
    }
    encoded[encoded.length] = value;
    for (let i = 0, length = encoded.length; i < length; i++) this.bytes[offset + i] = encoded[i];
    if (encoded.length < 5) {
      const remove = 5 - encoded.length;
      this.bytes.copyWithin(offset + encoded.length, offset + 5, this.offset);
      this.offset -= remove;
    }
  }
}

export class BinaryByteReader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  offset = 0;
  private readonly label: string;

  constructor(value: ArrayBuffer | ArrayBufferView, label = 'binary data') {
    if (value instanceof Uint8Array) {
      this.bytes = value;
    } else if (value instanceof ArrayBuffer) {
      this.bytes = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      this.bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      throw new TypeError(label + ' must be an ArrayBuffer or typed array');
    }
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.label = label;
  }

  readByte(): number {
    if (this.offset >= this.bytes.length) throw new TypeError('unexpected end of ' + this.label);
    return this.bytes[this.offset++];
  }

  readVarint(): number {
    const bytes = this.bytes;
    let offset = this.offset;
    let value = 0;
    let multiplier = 1;
    for (;;) {
      if (offset >= bytes.length) throw new TypeError('unexpected end of ' + this.label);
      const byte = bytes[offset++];
      value += (byte & 0x7f) * multiplier;
      if (value > Number.MAX_SAFE_INTEGER) {
        this.offset = offset;
        throw new TypeError(this.label + ' varint exceeds safe integer range');
      }
      if (byte < 0x80) {
        this.offset = offset;
        return value;
      }
      multiplier *= 0x80;
      if (multiplier > Number.MAX_SAFE_INTEGER) {
        this.offset = offset;
        throw new TypeError(this.label + ' varint exceeds safe integer range');
      }
    }
  }

  readSignedVarint(): number {
    const value = this.readVarint();
    return value % 2 === 1 ? -((value + 1) / 2) : value / 2;
  }

  readFloat64(): number {
    if (this.offset + 8 > this.bytes.length) throw new TypeError('unexpected end of ' + this.label);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  readDouble(): number {
    return this.readFloat64();
  }

  readUtf8StringPayload(): string {
    const length = this.readVarint();
    const end = this.offset + length;
    if (end > this.bytes.length) throw new TypeError('unexpected end of ' + this.label);
    const value = binaryTextDecoder.decode(this.bytes.subarray(this.offset, end));
    this.offset = end;
    return value;
  }

  skipUtf8StringPayload(): void {
    const length = this.readVarint();
    const end = this.offset + length;
    if (end > this.bytes.length) throw new TypeError('unexpected end of ' + this.label);
    this.offset = end;
  }
}

export interface BinaryPathCodecOptions {
  numberTag: number;
  stringTag: number;
  signedNumbers?: boolean;
  errorMessage: string;
}

export interface BinaryPathWriter {
  writeByte(value: number): void;
  writeVarint(value: number): void;
  writeSignedVarint(value: number): void;
  writeString(value: string): void;
}

export interface BinaryPathReader {
  readByte(): number;
  readVarint(): number;
  readSignedVarint(): number;
  readString(): string;
}

export function writeBinaryPathWithOptions(writer: BinaryPathWriter, path: JsonPath, options: BinaryPathCodecOptions): void {
  writer.writeVarint(path.length);
  for (let i = 0, length = path.length; i < length; i++) {
    const segment = path[i];
    if (typeof segment === 'number') {
      writer.writeByte(options.numberTag);
      if (options.signedNumbers === true) writer.writeSignedVarint(segment);
      else writer.writeVarint(segment);
    } else {
      writer.writeByte(options.stringTag);
      writer.writeString(segment);
    }
  }
}

export function readBinaryPathWithOptions(reader: BinaryPathReader, options: BinaryPathCodecOptions): JsonPath {
  const length = reader.readVarint();
  const path = new Array<string | number>(length);
  for (let i = 0; i < length; i++) {
    const tag = reader.readByte();
    if (tag === options.numberTag) {
      path[i] = options.signedNumbers === true ? reader.readSignedVarint() : reader.readVarint();
    } else if (tag === options.stringTag) {
      path[i] = reader.readString();
    } else {
      throw new TypeError(options.errorMessage);
    }
  }
  return path;
}

export interface BinaryJsonValueTags {
  null: number;
  false: number;
  true: number;
  int: number;
  double: number;
  string: number;
  array: number;
  object: number;
}

export const STANDARD_BINARY_JSON_VALUE_TAGS: BinaryJsonValueTags = {
  null: 0,
  false: 1,
  true: 2,
  int: 3,
  double: 4,
  string: 5,
  array: 6,
  object: 7
};

export interface BinaryJsonValueWriter {
  writeByte(value: number): void;
  writeVarint(value: number): void;
  writeSignedVarint(value: number): void;
  writeDouble(value: number): void;
  writeString(value: string): void;
}

export interface BinaryJsonValueReader {
  readByte(): number;
  readVarint(): number;
  readSignedVarint(): number;
  readDouble(): number;
  readString(): string;
  skipString?(): void;
}

export interface BinaryJsonValueCodecOptions {
  tags?: BinaryJsonValueTags;
  allowNegativeZeroInteger?: boolean;
  errorMessage: string;
}

export function writeBinaryJsonValueCore(
  writer: BinaryJsonValueWriter,
  value: JsonValue,
  options: BinaryJsonValueCodecOptions
): void {
  const tags = options.tags || STANDARD_BINARY_JSON_VALUE_TAGS;
  if (value === null) {
    writer.writeByte(tags.null);
  } else if (value === false) {
    writer.writeByte(tags.false);
  } else if (value === true) {
    writer.writeByte(tags.true);
  } else if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && (options.allowNegativeZeroInteger === true || !Object.is(value, -0))) {
      writer.writeByte(tags.int);
      writer.writeSignedVarint(value);
    } else {
      writer.writeByte(tags.double);
      writer.writeDouble(value);
    }
  } else if (typeof value === 'string') {
    writer.writeByte(tags.string);
    writer.writeString(value);
  } else if (Array.isArray(value)) {
    writer.writeByte(tags.array);
    writer.writeVarint(value.length);
    for (let i = 0, length = value.length; i < length; i++) writeBinaryJsonValueCore(writer, value[i], options);
  } else {
    const keys = Object.keys(value);
    writer.writeByte(tags.object);
    writer.writeVarint(keys.length);
    for (let i = 0, length = keys.length; i < length; i++) {
      const key = keys[i];
      writer.writeString(key);
      writeBinaryJsonValueCore(writer, value[key], options);
    }
  }
}

export function readBinaryJsonValueCore(reader: BinaryJsonValueReader, options: BinaryJsonValueCodecOptions): JsonValue {
  const tags = options.tags || STANDARD_BINARY_JSON_VALUE_TAGS;
  const tag = reader.readByte();
  if (tag === tags.null) return null;
  if (tag === tags.false) return false;
  if (tag === tags.true) return true;
  if (tag === tags.int) return reader.readSignedVarint();
  if (tag === tags.double) return reader.readDouble();
  if (tag === tags.string) return reader.readString();
  if (tag === tags.array) {
    const length = reader.readVarint();
    const array = new Array<JsonValue>(length);
    for (let i = 0; i < length; i++) array[i] = readBinaryJsonValueCore(reader, options);
    return array;
  }
  if (tag === tags.object) {
    const length = reader.readVarint();
    const object: JsonObject = {};
    for (let i = 0; i < length; i++) {
      setOwnValue(object, reader.readString(), readBinaryJsonValueCore(reader, options));
    }
    return object;
  }
  throw new TypeError(options.errorMessage);
}

export function skipBinaryJsonValueCore(reader: BinaryJsonValueReader, options: BinaryJsonValueCodecOptions): void {
  const tags = options.tags || STANDARD_BINARY_JSON_VALUE_TAGS;
  const tag = reader.readByte();
  if (tag === tags.null || tag === tags.false || tag === tags.true) return;
  if (tag === tags.int) {
    reader.readSignedVarint();
    return;
  }
  if (tag === tags.double) {
    reader.readDouble();
    return;
  }
  if (tag === tags.string) {
    if (reader.skipString !== undefined) reader.skipString();
    else reader.readString();
    return;
  }
  if (tag === tags.array) {
    const length = reader.readVarint();
    for (let i = 0; i < length; i++) skipBinaryJsonValueCore(reader, options);
    return;
  }
  if (tag === tags.object) {
    const length = reader.readVarint();
    for (let i = 0; i < length; i++) {
      if (reader.skipString !== undefined) reader.skipString();
      else reader.readString();
      skipBinaryJsonValueCore(reader, options);
    }
    return;
  }
  throw new TypeError(options.errorMessage);
}
