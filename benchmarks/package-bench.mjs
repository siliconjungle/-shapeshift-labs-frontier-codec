import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { applyPatchImmutable, diff } from '@shapeshift-labs/frontier';
import {
  applyEncodedPatchHistory,
  decodePatch,
  decodePatchFrame,
  encodePatch,
  encodePatchFrame,
  encodePatchHistory,
  inspectCodecFrame,
  readCodecFramePayload,
  stringifyCanonicalJson
} from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const args = parseArgs(process.argv.slice(2));
const rounds = readPositiveInt(args.rounds, 9);
const outPath = args.out ? path.resolve(rootDir, args.out) : null;

let sink = 0;

const fixture = createPatchFixture();
const historyFixture = createHistoryFixture();
const canonicalFixture = createCanonicalFixture();
const patchBytes = encodePatch(fixture.patch);
const frameBytes = encodePatchFrame(fixture.patch, {
  metadata: { fixture: '1k keyed-row edit' }
});
const historyBytes = encodePatchHistory(historyFixture.patches);

const rows = [
  runRow('Patch encode, 1k keyed-row edit', patchBytes.byteLength, () => {
    sink += encodePatch(fixture.patch).byteLength;
  }, 4000),
  runRow('Patch decode, 1k keyed-row edit', patchBytes.byteLength, () => {
    sink += decodePatch(patchBytes).length;
  }, 5000),
  runRow('Frame inspect + payload slice', frameBytes.byteLength, () => {
    const header = inspectCodecFrame(frameBytes);
    sink += readCodecFramePayload(frameBytes, header).byteLength;
  }, 5000),
  runRow('Frame decode, 1k keyed-row edit', frameBytes.byteLength, () => {
    sink += decodePatchFrame(frameBytes).length;
  }, 4000),
  runRow('History decode + apply, 128 patches', historyBytes.byteLength, () => {
    const next = applyEncodedPatchHistory(historyFixture.before, historyBytes);
    sink += next.rows.length;
  }, 250),
  runRow('Canonical JSON stringify', Buffer.byteLength(stringifyCanonicalJson(canonicalFixture)), () => {
    sink += stringifyCanonicalJson(canonicalFixture).length;
  }, 1000)
];

const report = {
  package: '@shapeshift-labs/frontier-codec',
  version: readPackageVersion(),
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform + ' ' + process.arch,
  rounds,
  rows
};

if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
}

assert.deepStrictEqual(decodePatch(patchBytes), fixture.patch);
assert.deepStrictEqual(decodePatchFrame(frameBytes), fixture.patch);
assert.deepStrictEqual(applyEncodedPatchHistory(historyFixture.before, historyBytes), historyFixture.after);

printReport(report);
if (sink === 42) console.log('sink=' + sink);

function runRow(name, bytes, fn, inner) {
  const timing = measure(fn, inner);
  return {
    fixture: name,
    bytes,
    medianUs: round(timing.median),
    p95Us: round(timing.p95)
  };
}

function createPatchFixture() {
  const before = { rows: makeRows(1000) };
  const after = cloneJson(before);
  after.rows[512] = { ...after.rows[512], score: 9999 };
  const patch = diff(before, after, { arrayKey: 'id' });
  assert.deepStrictEqual(applyPatchImmutable(before, patch), after);
  return { before, after, patch };
}

function createHistoryFixture() {
  const before = { rows: makeRows(128) };
  let current = cloneJson(before);
  const patches = [];
  for (let i = 0; i < 128; i++) {
    const next = cloneJson(current);
    next.rows[i] = { ...next.rows[i], score: next.rows[i].score + 1000 };
    const patch = diff(current, next, { dirtyPaths: [['rows', i, 'score']] });
    patches[patches.length] = patch;
    current = applyPatchImmutable(current, patch);
  }
  return { before, after: current, patches };
}

function createCanonicalFixture() {
  return {
    rows: makeRows(8),
    meta: {
      z: true,
      a: 'frontier-codec',
      nested: { beta: 2, alpha: 1 }
    }
  };
}

function makeRows(count) {
  const rows = new Array(count);
  for (let i = 0; i < count; i++) {
    rows[i] = { id: 'row-' + i, score: i, active: (i & 1) === 0, label: 'row ' + i };
  }
  return rows;
}

function measure(fn, inner) {
  for (let i = 0; i < inner; i++) fn();
  const samples = new Array(rounds);
  for (let roundIndex = 0; roundIndex < rounds; roundIndex++) {
    const start = performance.now();
    for (let i = 0; i < inner; i++) fn();
    samples[roundIndex] = ((performance.now() - start) * 1000) / inner;
  }
  samples.sort((left, right) => left - right);
  return {
    median: percentile(samples, 0.5),
    p95: percentile(samples, 0.95)
  };
}

function printReport(report) {
  console.log('@shapeshift-labs/frontier-codec package benchmark');
  console.log('Node ' + report.node + ' on ' + report.platform + ', rounds=' + rounds);
  console.log('These are Frontier-only package measurements, not competitor comparisons.');
  console.log('');
  console.log(padRight('Fixture', 42) + padLeft('Bytes', 10) + padLeft('Median', 12) + padLeft('p95', 11));
  for (const row of report.rows) {
    console.log(
      padRight(row.fixture, 42) +
      padLeft(formatBytes(row.bytes), 10) +
      padLeft(formatUs(row.medianUs), 12) +
      padLeft(formatUs(row.p95Us), 11)
    );
  }
  if (outPath) console.log('\nwrote ' + path.relative(rootDir, outPath));
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function readPackageVersion() {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rounds') out.rounds = argv[++i];
    else if (arg === '--out') out.out = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run bench -- [--rounds 9] [--out benchmarks/results/frontier-codec-package-bench.json]');
      process.exit(0);
    } else {
      throw new Error('unknown argument: ' + arg);
    }
  }
  return out;
}

function readPositiveInt(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error('expected positive integer, got ' + value);
  return number;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function formatUs(value) {
  return value.toFixed(2) + ' us';
}

function formatBytes(value) {
  return value < 1024 ? value + ' B' : (value / 1024).toFixed(1) + ' KiB';
}

function padRight(value, width) {
  return String(value).padEnd(width);
}

function padLeft(value, width) {
  return String(value).padStart(width);
}
