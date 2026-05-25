# Frontier Codec

Patch serialization, binary frames, and patch-history codecs for Frontier.

This package sits above [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier), the small JSON diff/apply core package. It keeps transport, persistence, and canonicalization helpers in a separate package so core imports stay small and predictable.

- npm: [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec)
- source: [`siliconjungle/-shapeshift-labs-frontier-codec`](https://github.com/siliconjungle/-shapeshift-labs-frontier-codec)
- license: MIT

## Related Packages

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): core JSON diff/apply primitives used by this package.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): shared query-key, selector path, condition, identity, and table-schema primitives.
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation): explicit mutation and selector plans compiled to Frontier patches or CRDT operations.

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-mutation`](https://github.com/siliconjungle/-shapeshift-labs-frontier-mutation)

## Install

```sh
npm install @shapeshift-labs/frontier @shapeshift-labs/frontier-codec
```

## Usage

```ts
import { diff, applyPatchImmutable } from '@shapeshift-labs/frontier';
import { encodePatch, decodePatch } from '@shapeshift-labs/frontier-codec';

const before = { count: 1 };
const after = { count: 2 };

const patch = diff(before, after);
const bytes = encodePatch(patch);
const decoded = decodePatch(bytes);

console.log(applyPatchImmutable(before, decoded));
```

## API

```ts
import {
  serializePatch,
  deserializePatch,
  encodePatch,
  decodePatch,
  encodePatchBase64url,
  decodePatchBase64url,
  encodePatchHistory,
  decodePatchHistory,
  applyPatchHistory,
  applyEncodedPatchHistory,
  createPatchHistoryBuilder,
  createCodecSchemaId,
  encodePatchFrame,
  decodePatchFrame,
  encodePatchHistoryFrame,
  decodePatchHistoryFrame,
  inspectCodecFrame,
  readCodecFramePayload,
  stringifyCanonicalJson,
  encodeCanonicalJson
} from '@shapeshift-labs/frontier-codec';
```

## What It Provides

Frontier Codec is for moving Frontier patches across process, network, and storage boundaries:

- `serializePatch()` / `deserializePatch()` for compact JSON-safe patch payloads.
- `encodePatch()` / `decodePatch()` for binary patch payloads.
- `encodePatchBase64url()` / `decodePatchBase64url()` for URL/header-safe transport strings.
- `encodePatchHistory()` / `decodePatchHistory()` for compact patch-history persistence.
- `applyPatchHistory()` / `applyEncodedPatchHistory()` for replaying stored histories.
- `createPatchHistoryBuilder()` for incremental history assembly.
- `encodePatchFrame()` / `decodePatchFrame()` for versioned typed wire frames.
- `inspectCodecFrame()` / `readCodecFramePayload()` for metadata-first frame handling.
- `stringifyCanonicalJson()` / `encodeCanonicalJson()` for deterministic signing, hashing, and cache keys.

### Binary Patch Transport

```ts
import { diff, applyPatchImmutable } from '@shapeshift-labs/frontier';
import { encodePatchBase64url, decodePatchBase64url } from '@shapeshift-labs/frontier-codec';

const patch = diff({ title: 'Draft' }, { title: 'Published' });
const token = encodePatchBase64url(patch);

const received = decodePatchBase64url(token);
const next = applyPatchImmutable({ title: 'Draft' }, received);
```

### Patch History

```ts
import { applyEncodedPatchHistory, encodePatchHistory } from '@shapeshift-labs/frontier-codec';

const encoded = encodePatchHistory([
  [{ op: 'add', path: ['items'], value: [] }],
  [{ op: 'add', path: ['items', 0], value: { id: 'a', done: false } }]
]);

const current = applyEncodedPatchHistory({}, encoded);
```

### Versioned Frames

```ts
import { encodePatchFrame, inspectCodecFrame, readCodecFramePayload } from '@shapeshift-labs/frontier-codec';

const frame = encodePatchFrame([{ op: 'replace', path: ['count'], value: 2 }], {
  schemaId: 'counter-v1'
});

const info = inspectCodecFrame(frame);
const bytes = readCodecFramePayload(frame);
```

### Canonical JSON

```ts
import { stringifyCanonicalJson } from '@shapeshift-labs/frontier-codec/canonical';

const stable = stringifyCanonicalJson({ b: 2, a: 1 });
// {"a":1,"b":2}
```

## Subpath Imports

```ts
import { encodePatch } from '@shapeshift-labs/frontier-codec/codec';
import { encodePatchHistory } from '@shapeshift-labs/frontier-codec/history';
import { encodePatchFrame } from '@shapeshift-labs/frontier-codec/frame';
import { stringifyCanonicalJson } from '@shapeshift-labs/frontier-codec/canonical';
import type { PatchHistoryCodecOptions } from '@shapeshift-labs/frontier-codec/types';
```

## Package Scope

This package is intentionally limited to:

- Frontier patch string and binary codecs.
- Base64url patch transport helpers.
- Patch-history encoding and replay.
- Versioned codec frames.
- Canonical JSON helpers for transport, hashing, and signing workflows.

CRDT update codecs live in the CRDT package layer. State routing, sync providers, awareness, rich text, and document handles are separate layers.

## TypeScript

The package ships ESM JavaScript plus `.d.ts` declarations for every public subpath. The package-local TypeScript source lives in `src/` and compiles directly to `dist/`; it is not copied from the monorepo root build output.

## Validation

The package test suite covers:

- smoke imports for every public subpath;
- type-checking examples against the published declarations;
- deterministic patch/history/frame/canonical conformance cases;
- index-list binary codec fuzzing;
- patch/history/frame round-trip fuzzing against `@shapeshift-labs/frontier` diff/apply.

Run it with:

```sh
npm test
```

Run the package-local fuzzer directly:

```sh
npm run fuzz
```

For a publish dry run:

```sh
npm run pack:dry
```

## Benchmarks

Run the package-local benchmark:

```sh
npm run bench
```

Latest local package-gate run on Node v26.1.0, darwin arm64, 3 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| Patch encode, 1k keyed-row edit, 30 B | 0.66 us | 0.76 us |
| Patch decode, 1k keyed-row edit, 30 B | 0.34 us | 0.35 us |
| Frame inspect + payload slice, 70 B | 0.42 us | 0.43 us |
| Frame decode, 1k keyed-row edit, 70 B | 0.63 us | 0.64 us |
| History decode+apply, 128 patches, 2.8 KiB | 58.58 us | 58.80 us |
| Canonical JSON stringify, 523 B | 6.98 us | 7.11 us |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
