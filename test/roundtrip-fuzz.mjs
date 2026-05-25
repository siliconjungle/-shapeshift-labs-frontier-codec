import assert from 'node:assert';
import {
  applyPatchImmutable,
  cloneJson,
  diff,
  equalsJson
} from '@shapeshift-labs/frontier';
import {
  applyPatchHistory,
  decodePatch,
  decodePatchFrame,
  decodePatchHistory,
  decodePatchHistoryFrame,
  encodePatch,
  encodePatchFrame,
  encodePatchHistory,
  encodePatchHistoryFrame
} from '../dist/index.js';

const DEFAULT_CASES = 400;
const DEFAULT_SEED = 0xc0decafe;

const args = parseArgs(process.argv.slice(2));
const cases = readInt(args.cases, DEFAULT_CASES);
const seed = readInt(args.seed, DEFAULT_SEED) >>> 0;
const rng = createXorShift32(seed);

for (let i = 0; i < cases; i++) runCase(i, rng);

console.log('frontier-codec roundtrip fuzz passed cases=' + cases + ' seed=' + seed);

function runCase(id, rng) {
  const initial = makeState(rng);
  const patches = [];
  let source = initial;
  let target = initial;
  const steps = 1 + randomInt(rng, 5);

  for (let i = 0; i < steps; i++) {
    target = mutateState(source, rng, id + i);
    const patch = diff(source, target, { arrayKey: 'id', adaptive: true, validate: true });
    assertPatchRoundtrip(source, target, patch, id + ':' + i);
    patches.push(patch);
    source = target;
  }

  const historyBytes = encodePatchHistory(patches, { validate: false });
  const decodedHistory = decodePatchHistory(historyBytes, { validate: false });
  assert.deepStrictEqual(decodedHistory, patches);
  assert.strictEqual(equalsJson(applyPatchHistory(initial, decodedHistory), target), true);

  const frame = encodePatchHistoryFrame(patches, {
    validate: false,
    schemaId: 'frontier-codec-fuzz',
    metadata: { id }
  });
  assert.deepStrictEqual(decodePatchHistoryFrame(frame, { validate: false }), patches);
}

function assertPatchRoundtrip(source, target, patch, id) {
  const decoded = decodePatch(encodePatch(patch, { validate: false }), { validate: false });
  if (!equalsJson(decoded, patch)) fail('patch binary mismatch', id, source, target, patch, decoded);
  if (!equalsJson(applyPatchImmutable(source, decoded), target)) fail('patch apply mismatch', id, source, target, patch, decoded);

  const frame = encodePatchFrame(decoded, {
    validate: false,
    schemaId: 'frontier-codec-fuzz',
    metadata: { id }
  });
  assert.deepStrictEqual(decodePatchFrame(frame, { validate: false }), decoded);
}

function makeState(rng) {
  const rows = new Array(12);
  for (let i = 0; i < rows.length; i++) {
    rows[i] = {
      id: 'row-' + i,
      score: randomInt(rng, 1000),
      active: (i & 1) === 0,
      tags: ['t' + (i & 3)]
    };
  }
  return {
    meta: { tick: randomInt(rng, 1000), label: 'seed-' + randomInt(rng, 1000) },
    rows,
    text: 'codec-fuzz'
  };
}

function mutateState(value, rng, salt) {
  const out = cloneJson(value);
  const choice = randomInt(rng, 5);
  if (choice === 0) out.meta.tick = salt + randomInt(rng, 10000);
  else if (choice === 1) out.rows[randomInt(rng, out.rows.length)].score = randomInt(rng, 10000);
  else if (choice === 2) out.rows.push({ id: 'row-new-' + salt, score: randomInt(rng, 10000), active: true, tags: [] });
  else if (choice === 3 && out.rows.length > 1) out.rows.splice(randomInt(rng, out.rows.length), 1);
  else out.text = mutateString(out.text, rng);
  return out;
}

function mutateString(value, rng) {
  const index = randomInt(rng, value.length + 1);
  const deleteCount = value.length === 0 ? 0 : randomInt(rng, Math.min(3, value.length - Math.min(index, value.length)) + 1);
  const insert = String.fromCharCode(97 + randomInt(rng, 26)).repeat(randomInt(rng, 4));
  return value.slice(0, index) + insert + value.slice(index + deleteCount);
}

function fail(message, id, source, target, patch, actual) {
  console.error(message + ' case=' + id);
  console.error(JSON.stringify({ source, target, patch, actual }, null, 2));
  process.exit(1);
}

function createXorShift32(seed) {
  let state = seed || 0x9e3779b9;
  return function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function randomInt(rng, max) {
  return rng() % Math.max(1, max);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cases') out.cases = argv[++i];
    else if (arg === '--seed') out.seed = argv[++i];
    else throw new Error('unknown argument: ' + arg);
  }
  return out;
}

function readInt(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('expected positive integer, got ' + value);
  return parsed;
}
