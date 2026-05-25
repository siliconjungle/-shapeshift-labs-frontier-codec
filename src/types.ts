import type {
  ApplyOptions,
  JsonArray,
  JsonObject,
  JsonPath,
  JsonPrimitive,
  JsonRecord,
  JsonValidationOptions,
  JsonValue,
  ObjectKey,
  Patch,
  PatchOperation,
  PathSegment,
  TextLengthUnit,
  TextSegment,
  TextSegmentationOptions,
  TextSegmentGranularity,
  UnicodeNormalizationForm
} from '@shapeshift-labs/frontier/types';

export type {
  ApplyOptions,
  JsonArray,
  JsonObject,
  JsonPath,
  JsonPrimitive,
  JsonRecord,
  JsonValidationOptions,
  JsonValue,
  ObjectKey,
  Patch,
  PatchOperation,
  PathSegment,
  TextLengthUnit,
  TextSegment,
  TextSegmentationOptions,
  TextSegmentGranularity,
  UnicodeNormalizationForm
};

/** RFC8785/JCS-style canonical JSON serialization options. */
export interface CanonicalJsonOptions extends JsonValidationOptions {
  /** Validate the input before serializing. Defaults to true. */
  validate?: boolean;
}

/** Binary or JSON patch codec options. */
export interface CodecOptions {
  /** Validate trusted patch data before encoding or decoding. */
  validate?: boolean;
}

/** Binary patch-history codec and replay options. */
export interface PatchHistoryCodecOptions extends CodecOptions {
  /**
   * Replay only the first N patches from a history stream. This enables point-in-time
   * materialization without decoding the complete history.
   */
  until?: number;
}

/** Streaming patch-history builder. It avoids materializing a `Patch[]` when a producer already has operation events. */
export interface PatchHistoryBuilder {
  /** Number of operation patches recorded so far. */
  readonly length: number;

  /** Add a compact patch to the stream. Non-specialized patches are preserved through the generic history codec. */
  addPatch(patch: Patch): this;

  /** Add a string splice operation as its own history patch. Same-path appends use the compact streaming mode. */
  stringSplice(path: JsonPath, start: number, deleteCount: number, insert: string): this;

  /** Convenience alias for `stringSplice(path, start, 0, insert)`. */
  appendString(path: JsonPath, start: number, insert: string): this;

  /** Encode all recorded operations. */
  finish(options?: PatchHistoryCodecOptions): Uint8Array;

  /** Clear all recorded operations and reuse the builder. */
  reset(): void;
}
