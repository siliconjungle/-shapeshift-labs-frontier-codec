import { diff, applyPatchImmutable } from '@shapeshift-labs/frontier';
import type { JsonValue, Patch, PatchHistoryBuilder } from '../dist/types.js';
import {
  applyEncodedPatchHistory,
  createCodecSchemaId,
  createPatchHistoryBuilder,
  decodePatch,
  decodePatchFrame,
  encodeCanonicalJson,
  encodePatch,
  encodePatchFrame,
  stringifyCanonicalJson
} from '../dist/index.js';

const before: JsonValue = { count: 1 };
const after: JsonValue = { count: 2 };
const patch: Patch = diff(before, after);
const bytes: Uint8Array = encodePatch(patch);
const decoded: Patch = decodePatch(bytes);
const frame: Uint8Array = encodePatchFrame(decoded, {
  schemaId: createCodecSchemaId({ type: 'counter' }),
  metadata: { source: 'types' }
});

applyPatchImmutable(before, decodePatchFrame(frame));
stringifyCanonicalJson({ b: 2, a: 1 });
encodeCanonicalJson({ b: 2, a: 1 });

const builder: PatchHistoryBuilder = createPatchHistoryBuilder();
builder.addPatch(patch).appendString(['body'], 0, 'x');
applyEncodedPatchHistory(before, builder.finish());
