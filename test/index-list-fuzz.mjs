import assert from 'node:assert';
import {
  OP_ARRAY_ASSIGN,
  OP_ARRAY_OBJECT_ASSIGN,
  OP_ARRAY_OBJECT_FIELD_ASSIGN,
  OP_ARRAY_TUPLE_ASSIGN
} from '@shapeshift-labs/frontier/constants';
import { decodePatch, encodePatch } from '../dist/index.js';

const DEFAULT_CASES = 320;
const DEFAULT_SEED = 0x1d2c0dec;

const args = parseArgs(process.argv.slice(2));
const cases = readInt(args.cases, DEFAULT_CASES);
const seed = readInt(args.seed, DEFAULT_SEED) >>> 0;
const rng = createXorShift32(seed);

for (let id = 0; id < cases; id++) {
  const indexes = makeIndexList(id, rng);
  const patch = makePatch(id, indexes);
  const bytes = encodePatch(patch);
  assert.deepStrictEqual(decodePatch(bytes), patch);
  assert.deepStrictEqual(decodePatch(encodePatch(decodePatch(bytes))), patch);
}

console.log('frontier-codec index-list fuzz passed cases=' + cases + ' seed=' + seed);

function makePatch(id, indexes) {
  if (id % 4 === 0) {
    return [[OP_ARRAY_ASSIGN, [], indexes, indexes.map((value) => -((value & 65535) + 1))]];
  }

  if (id % 4 === 1) {
    return [[
      OP_ARRAY_OBJECT_ASSIGN,
      ['rows'],
      indexes,
      indexes.map((value, index) => ({ score: value & 1023, bucket: index & 31 }))
    ]];
  }

  if (id % 4 === 2) {
    return [[
      OP_ARRAY_TUPLE_ASSIGN,
      ['tuples'],
      indexes,
      indexes.map((_, index) => index & 7),
      indexes.map((value) => (value & 255) + 0.5)
    ]];
  }

  const fieldPaths = [['active'], ['rank']];
  const values = new Array(indexes.length * fieldPaths.length);
  for (let i = 0; i < indexes.length; i++) {
    values[i * 2] = (indexes[i] & 1) === 0;
    values[i * 2 + 1] = indexes[i] & 255;
  }
  return [[OP_ARRAY_OBJECT_FIELD_ASSIGN, ['nodes'], indexes, fieldPaths, values]];
}

function makeIndexList(id, rng) {
  const shape = id % 8;
  if (shape === 0) return makeRun(1 + randomInt(rng, 400), randomInt(rng, 64));
  if (shape === 1) return makeArithmetic(3 + randomInt(rng, 300), randomInt(rng, 64), 2 + randomInt(rng, 256));
  if (shape === 2) return makeRandomIncreasing(1 + randomInt(rng, 511), 1 + randomInt(rng, 10), rng);
  if (shape === 3) return makeRandomIncreasing(32 + randomInt(rng, 400), 900 + randomInt(rng, 4096), rng);
  if (shape === 4) return makeClustered(32 + randomInt(rng, 400), rng);
  if (shape === 5) return makeShortSparse(1 + randomInt(rng, 511), rng);
  if (shape === 6) return makeAlternating(32 + randomInt(rng, 400), rng);
  return makeRandomIncreasing(1 + randomInt(rng, 127), Math.max(1, Math.floor((11 + randomInt(rng, 90)) / 10)), rng);
}

function makeRun(length, start) {
  return Array.from({ length }, (_, index) => start + index);
}

function makeArithmetic(length, start, step) {
  return Array.from({ length }, (_, index) => start + index * step);
}

function makeRandomIncreasing(length, averageGap, rng) {
  const out = new Array(length);
  let value = randomInt(rng, Math.max(1, averageGap * 8));
  for (let i = 0; i < length; i++) {
    value += 1 + randomInt(rng, Math.max(1, averageGap * 2));
    out[i] = value;
  }
  return out;
}

function makeClustered(length, rng) {
  const out = [];
  let value = randomInt(rng, 128);
  while (out.length < length) {
    const runLength = Math.min(length - out.length, 1 + randomInt(rng, 24));
    for (let i = 0; i < runLength; i++) out[out.length] = value + i;
    value += runLength + 512 + randomInt(rng, 4096);
  }
  return out;
}

function makeShortSparse(length, rng) {
  const out = new Array(length);
  let value = randomInt(rng, 50000);
  for (let i = 0; i < length; i++) {
    value += 1 + randomInt(rng, 50000);
    out[i] = value;
  }
  return out;
}

function makeAlternating(length, rng) {
  const out = new Array(length);
  let value = randomInt(rng, 32);
  for (let i = 0; i < length; i++) {
    value += (i & 1) === 0 ? 1 + randomInt(rng, 4) : 512 + randomInt(rng, 2048);
    out[i] = value;
  }
  return out;
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
