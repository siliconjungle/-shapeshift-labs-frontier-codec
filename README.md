# Frontier Codec

Patch serialization, binary frames, and patch-history codecs for Frontier.

This package sits above [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier), the small JSON diff/apply core package. It keeps transport, persistence, and canonicalization helpers in a separate package so core imports stay small and predictable.

- npm: [`@shapeshift-labs/frontier-codec`](https://www.npmjs.com/package/@shapeshift-labs/frontier-codec)
- source: [`siliconjungle/-shapeshift-labs-frontier-codec`](https://github.com/siliconjungle/-shapeshift-labs-frontier-codec)
- license: MIT

## Related Packages

The published Frontier package family is generated from one shared package catalog so READMEs stay in sync across packages:

- [`@shapeshift-labs/frontier`](https://www.npmjs.com/package/@shapeshift-labs/frontier): Core JSON diff/apply, compact patch tuples, JSON Pointer, equality, clone, validation, Unicode helpers.
- [`@shapeshift-labs/frontier-query`](https://www.npmjs.com/package/@shapeshift-labs/frontier-query): Shared query-key, selector path, condition, entity identity, and table-shape primitives.
- [`@shapeshift-labs/frontier-engine`](https://www.npmjs.com/package/@shapeshift-labs/frontier-engine): Stateful planned diff engine, adaptive profiles, schema plans, and engine-level history helpers.
- [`@shapeshift-labs/frontier-state`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state): Patch-routed app-state subscriptions, owned commits, maintained views, and path mapping.
- [`@shapeshift-labs/frontier-state-cache`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache): Normalized query-result cache with entity/query watchers, persistence, change logs, optimistic layers, and mutation bridge.
- [`@shapeshift-labs/frontier-state-cache-idb`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-idb): IndexedDB persistence adapter for Frontier state-cache snapshots.
- [`@shapeshift-labs/frontier-state-cache-file`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-file): Structured file persistence adapter for Frontier state-cache snapshots and change logs.
- [`@shapeshift-labs/frontier-state-cache-sql`](https://www.npmjs.com/package/@shapeshift-labs/frontier-state-cache-sql): SQL persistence adapter for Frontier state-cache snapshots and change logs.
- [`@shapeshift-labs/frontier-schema`](https://www.npmjs.com/package/@shapeshift-labs/frontier-schema): JSON Schema validation, Frontier profile generation, CloudEvent envelopes, and query/table schema helpers.
- [`@shapeshift-labs/frontier-event-log`](https://www.npmjs.com/package/@shapeshift-labs/frontier-event-log): Bounded event logs, replay cursors, consumer acknowledgements, keyed compaction, checkpoints, and Frontier patch event records.
- [`@shapeshift-labs/frontier-logging`](https://www.npmjs.com/package/@shapeshift-labs/frontier-logging): Opt-in structured logging, browser telemetry, file sinks, exporters, benchmark traces, and Frontier patch/update summaries.
- [`@shapeshift-labs/frontier-mutation`](https://www.npmjs.com/package/@shapeshift-labs/frontier-mutation): Explicit mutation and selector plans compiled to Frontier patches or CRDT operations.
- [`@shapeshift-labs/frontier-crdt`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt): Native CRDT documents, update tooling, awareness, branches, conflict introspection, version frames, and undo.
- [`@shapeshift-labs/frontier-crdt-sync`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-sync): CRDT sync endpoints, repo/storage/provider contracts, document URLs, local networks, model checking, forensics, and text binding contracts.
- [`@shapeshift-labs/frontier-crdt-websocket`](https://www.npmjs.com/package/@shapeshift-labs/frontier-crdt-websocket): WebSocket client/server transports for Frontier CRDT sync providers.
- [`@shapeshift-labs/frontier-react`](https://www.npmjs.com/package/@shapeshift-labs/frontier-react): React external-store hooks and adapters for Frontier state, cache, and CRDT surfaces.
- [`@shapeshift-labs/frontier-richtext`](https://www.npmjs.com/package/@shapeshift-labs/frontier-richtext): Rich text Delta normalization/application, marks, embeds, ranges, and cursor/selection transforms for local editor integrations.
- [`@shapeshift-labs/frontier-realtime`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime): Shared realtime command, tick, snapshot, prediction, reconciliation, interpolation, rollback, message, and delta primitives.
- [`@shapeshift-labs/frontier-realtime-server`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime-server): Authoritative realtime room, tick, command validation, rate-limit, session, and snapshot-history runtime.
- [`@shapeshift-labs/frontier-realtime-websocket`](https://www.npmjs.com/package/@shapeshift-labs/frontier-realtime-websocket): WebSocket client, wire, and Node room-server transport for Frontier realtime.
- [`@shapeshift-labs/frontier-game`](https://www.npmjs.com/package/@shapeshift-labs/frontier-game): Game-facing entity, component, player, room, ownership, spatial interest, rollback, physics, and replication helpers above realtime.

Package source repositories:

- [`siliconjungle/-shapeshift-labs-frontier`](https://github.com/siliconjungle/-shapeshift-labs-frontier)
- [`siliconjungle/-shapeshift-labs-frontier-query`](https://github.com/siliconjungle/-shapeshift-labs-frontier-query)
- [`siliconjungle/-shapeshift-labs-frontier-codec`](https://github.com/siliconjungle/-shapeshift-labs-frontier-codec)
- [`siliconjungle/-shapeshift-labs-frontier-engine`](https://github.com/siliconjungle/-shapeshift-labs-frontier-engine)
- [`siliconjungle/-shapeshift-labs-frontier-state`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-idb`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-idb)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-file`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-file)
- [`siliconjungle/-shapeshift-labs-frontier-state-cache-sql`](https://github.com/siliconjungle/-shapeshift-labs-frontier-state-cache-sql)
- [`siliconjungle/-shapeshift-labs-frontier-schema`](https://github.com/siliconjungle/-shapeshift-labs-frontier-schema)
- [`siliconjungle/-shapeshift-labs-frontier-event-log`](https://github.com/siliconjungle/-shapeshift-labs-frontier-event-log)
- [`siliconjungle/-shapeshift-labs-frontier-logging`](https://github.com/siliconjungle/-shapeshift-labs-frontier-logging)
- [`siliconjungle/-shapeshift-labs-frontier-mutation`](https://github.com/siliconjungle/-shapeshift-labs-frontier-mutation)
- [`siliconjungle/-shapeshift-labs-frontier-crdt`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-sync`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-sync)
- [`siliconjungle/-shapeshift-labs-frontier-crdt-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-crdt-websocket)
- [`siliconjungle/-shapeshift-labs-frontier-react`](https://github.com/siliconjungle/-shapeshift-labs-frontier-react)
- [`siliconjungle/-shapeshift-labs-frontier-richtext`](https://github.com/siliconjungle/-shapeshift-labs-frontier-richtext)
- [`siliconjungle/-shapeshift-labs-frontier-realtime`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime)
- [`siliconjungle/-shapeshift-labs-frontier-realtime-server`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-server)
- [`siliconjungle/-shapeshift-labs-frontier-realtime-websocket`](https://github.com/siliconjungle/-shapeshift-labs-frontier-realtime-websocket)
- [`siliconjungle/-shapeshift-labs-frontier-game`](https://github.com/siliconjungle/-shapeshift-labs-frontier-game)

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

Latest local package benchmark on Node v26.1.0, darwin arm64, 3 rounds:

| Fixture | Median | p95 |
| --- | ---: | ---: |
| Patch encode, 1k keyed-row edit, 30 B | 0.61 us | 0.66 us |
| Patch decode, 1k keyed-row edit, 30 B | 0.36 us | 0.43 us |
| Frame inspect + payload slice, 70 B | 0.40 us | 0.42 us |
| Frame decode, 1k keyed-row edit, 70 B | 0.59 us | 0.62 us |
| History decode+apply, 128 patches, 2.8 KiB | 56.11 us | 56.47 us |
| Canonical JSON stringify, 523 B | 6.34 us | 6.49 us |

These are Frontier-only package measurements, not competitor comparisons.

## License

MIT. See [LICENSE](./LICENSE).
