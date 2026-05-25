import assert from 'node:assert';

const codec = await import('../dist/index.js');
const codecOnly = await import('../dist/codec.js');
const historyOnly = await import('../dist/history.js');
const frameOnly = await import('../dist/codec-frame.js');
const canonicalOnly = await import('../dist/canonical.js');

const patch = [
  [0, ['todos', 0, 'done'], true],
  [3, ['todos'], [{ id: 'c', done: false }]]
];

const serialized = codec.serializePatch(patch);
assert.deepStrictEqual(codec.deserializePatch(serialized), patch);
assert.deepStrictEqual(codec.decodePatch(codec.encodePatch(patch)), patch);
assert.deepStrictEqual(codec.decodePatchBase64url(codec.encodePatchBase64url(patch)), patch);
assert.strictEqual(codecOnly.encodePatch, codec.encodePatch);

const history = [patch, [[0, ['meta', 'version'], 2]]];
const encodedHistory = codec.encodePatchHistory(history);
const decodedHistory = codec.decodePatchHistory(encodedHistory);
assert.strictEqual(decodedHistory.length, 2);
assert.strictEqual(historyOnly.encodePatchHistory, codec.encodePatchHistory);

const frame = codec.encodePatchFrame(patch, { metadata: { kind: 'smoke' } });
assert.deepStrictEqual(codec.decodePatchFrame(frame), patch);
assert.strictEqual(codec.inspectCodecFrame(frame).kind, 'patch');
assert.strictEqual(frameOnly.encodePatchFrame, codec.encodePatchFrame);

const canonical = codec.stringifyCanonicalJson({ b: 2, a: 1 });
assert.strictEqual(canonical, '{"a":1,"b":2}');
assert.strictEqual(canonicalOnly.stringifyCanonicalJson, codec.stringifyCanonicalJson);

assert.strictEqual(codec.createCrdtDocument, undefined);
assert.strictEqual(codec.createStateEngine, undefined);
