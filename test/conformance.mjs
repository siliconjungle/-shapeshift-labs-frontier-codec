import assert from 'node:assert';
import {
  applyPatchImmutable,
  cloneJson,
  diff,
  equalsJson
} from '@shapeshift-labs/frontier';
import {
  applyPatchHistory,
  createCodecSchemaId,
  decodePatch,
  decodePatchFrame,
  decodePatchHistory,
  decodePatchHistoryFrame,
  encodePatch,
  encodePatchFrame,
  encodePatchHistory,
  encodePatchHistoryFrame,
  inspectCodecFrame,
  readCodecFramePayload,
  stringifyCanonicalJson
} from '../dist/index.js';

const cases = [
  {
    name: 'patch-binary-roundtrip',
    run() {
      const source = { rows: [{ id: 'a', score: 1 }, { id: 'b', score: 2 }], meta: { tick: 0 } };
      const target = { rows: [{ id: 'a', score: 3 }, { id: 'b', score: 2 }, { id: 'c', score: 4 }], meta: { tick: 1 } };
      const patch = diff(source, target, { arrayKey: 'id', adaptive: true, validate: true });
      const decoded = decodePatch(encodePatch(patch));
      assert.deepStrictEqual(decoded, patch);
      assert.deepStrictEqual(applyPatchImmutable(source, decoded), target);
    }
  },
  {
    name: 'patch-history-roundtrip',
    run() {
      const states = [
        { meta: { tick: 0 }, text: 'a' },
        { meta: { tick: 1 }, text: 'ab' },
        { meta: { tick: 2 }, text: 'abc' }
      ];
      const patches = [
        diff(states[0], states[1], { validate: true }),
        diff(states[1], states[2], { validate: true })
      ];
      const decoded = decodePatchHistory(encodePatchHistory(patches));
      assert.deepStrictEqual(decoded, patches);
      assert.deepStrictEqual(applyPatchHistory(states[0], decoded), states[2]);
    }
  },
  {
    name: 'patch-frame-roundtrip',
    run() {
      const source = { rows: [{ id: 'a', score: 1 }], meta: { tick: 0 } };
      const target = { rows: [{ id: 'a', score: 2 }], meta: { tick: 1 } };
      const patch = diff(source, target, { arrayKey: 'id', validate: true });
      const schema = { type: 'object', fields: ['rows', 'meta'] };
      const schemaId = createCodecSchemaId(schema);
      const frame = encodePatchFrame(patch, {
        schemaId,
        metadata: { source: 'codec-conformance', seq: 1 },
        validate: false
      });
      const header = inspectCodecFrame(frame);
      assert.strictEqual(header.kind, 'patch');
      assert.strictEqual(header.version, 1);
      assert.strictEqual(header.schemaId, schemaId);
      assert.deepStrictEqual(header.metadata, { seq: 1, source: 'codec-conformance' });
      const payload = readCodecFramePayload(frame, header);
      assert.strictEqual(payload.buffer, frame.buffer);
      assert.deepStrictEqual(decodePatch(payload, { validate: false }), patch);
      assert.deepStrictEqual(decodePatchFrame(frame, { expectedSchemaId: schemaId, validate: false }), patch);
      assert.deepStrictEqual(applyPatchImmutable(source, decodePatchFrame(frame, { validate: false })), target);
    }
  },
  {
    name: 'patch-history-frame-roundtrip',
    run() {
      const states = [
        { meta: { tick: 0 }, text: 'a' },
        { meta: { tick: 1 }, text: 'ab' },
        { meta: { tick: 2 }, text: 'abc' }
      ];
      const patches = [
        diff(states[0], states[1], { validate: true }),
        diff(states[1], states[2], { validate: true })
      ];
      const schemaId = createCodecSchemaId({ type: 'history', version: 1 });
      const frame = encodePatchHistoryFrame(patches, { schemaId, metadata: { source: 'history-frame' } });
      const header = inspectCodecFrame(frame);
      assert.strictEqual(header.kind, 'patch-history');
      assert.strictEqual(header.schemaId, schemaId);
      const decoded = decodePatchHistoryFrame(frame, { expectedSchemaId: schemaId });
      assert.deepStrictEqual(decoded, patches);
      assert.deepStrictEqual(applyPatchHistory(states[0], decoded), states[2]);
    }
  },
  {
    name: 'invalid-patch-header',
    run() {
      assert.throws(() => decodePatch(new Uint8Array([1, 2, 3, 4])), /invalid binary patch header/);
    }
  },
  {
    name: 'invalid-history-header',
    run() {
      assert.throws(() => decodePatchHistory(new Uint8Array([1, 2, 3, 4])), /invalid binary patch history header/);
    }
  },
  {
    name: 'invalid-frame-schema-id',
    run() {
      const frame = encodePatchFrame(diff({ a: 1 }, { a: 2 }), { schemaId: 'schema-a' });
      assert.throws(() => decodePatchFrame(frame, { expectedSchemaId: 'schema-b' }), /schemaId mismatch/);
    }
  },
  {
    name: 'invalid-frame-metadata-budget',
    run() {
      const frame = encodePatchFrame(diff({ a: 1 }, { a: 2 }), { metadata: { source: 'budget' } });
      assert.throws(() => inspectCodecFrame(frame, { maxMetadataBytes: 0 }), /metadata exceeds maxMetadataBytes/);
    }
  },
  {
    name: 'invalid-frame-trailing-data',
    run() {
      const frame = encodePatchFrame(diff({ a: 1 }, { a: 2 }));
      const withTrailing = new Uint8Array(frame.byteLength + 1);
      withTrailing.set(frame);
      assert.throws(() => inspectCodecFrame(withTrailing), /trailing codec frame data/);
    }
  },
  {
    name: 'canonical-key-order',
    run() {
      assert.strictEqual(stringifyCanonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
    }
  },
  {
    name: 'patch-codec-does-not-mutate-input',
    run() {
      const source = { nested: { a: 1 }, list: [1, 2] };
      const target = { nested: { a: 2 }, list: [1, 2, 3] };
      const before = cloneJson(source);
      const decoded = decodePatch(encodePatch(diff(source, target, { validate: true })));
      assert.deepStrictEqual(source, before);
      assert.strictEqual(equalsJson(applyPatchImmutable(source, decoded), target), true);
    }
  }
];

for (const testCase of cases) testCase.run();

console.log('frontier-codec conformance passed cases=' + cases.length);
