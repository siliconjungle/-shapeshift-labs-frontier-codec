// Future @shapeshift-labs/frontier-codec package surface.
export {
  assertPatch,
  serializePatch,
  deserializePatch,
  encodePatch,
  decodePatch,
  encodePatchBase64url,
  decodePatchBase64url
} from './codec.js';
export {
  encodePatchHistory,
  decodePatchHistory,
  applyPatchHistory,
  applyEncodedPatchHistory,
  createPatchHistoryBuilder
} from './history.js';
export {
  createCodecSchemaId,
  encodePatchFrame,
  decodePatchFrame,
  encodePatchHistoryFrame,
  decodePatchHistoryFrame,
  inspectCodecFrame,
  readCodecFramePayload
} from './codec-frame.js';
export { stringifyCanonicalJson, encodeCanonicalJson } from './canonical.js';

export type {
  CanonicalJsonOptions,
  CodecOptions,
  JsonPath,
  JsonValue,
  Patch,
  PatchHistoryBuilder,
  PatchHistoryCodecOptions,
  PatchOperation
} from './types.js';
export type {
  CodecFrameDecodeOptions,
  CodecFrameEncodeOptions,
  CodecFrameHeader,
  CodecFrameInspectOptions,
  CodecFrameKind,
  CodecHistoryFrameDecodeOptions,
  CodecHistoryFrameEncodeOptions,
  CodecSchemaIdOptions
} from './codec-frame.js';
