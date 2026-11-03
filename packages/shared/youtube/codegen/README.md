# Assertion-free YouTube protobuf generation

The source is `../stream_list.proto`. Generate or verify its checked-in TypeScript:

```sh
bun run --cwd packages/shared gen:youtube
bun run --cwd packages/shared check:youtube
bun run --cwd packages/shared typecheck
bun run --cwd packages/shared test
bun test packages/desktop/tests/youtube-grpc.test.ts
```

The desktop `gen` command uses the same entry point. Buf 1.75.0 is a shared development
dependency. Generated files remain regular TypeScript and participate in the project's
lint and type checks.

`source.ts` pins ts-proto 2.18.3's npm archive and its SHA-512 integrity from `bun.lock`,
plus the SHA-256 of `ts-proto.patch`. Preparation downloads and verifies the pristine
archive, applies the template patch in an external cache, and atomically publishes
that cache. Installed `node_modules` are never modified; the cache links to the pinned
installed generator's dependency directory. `TWIRCHAT_CODEGEN_CACHE` can select a
separate cache root. The upstream ISC license is included alongside this README.

Upstream 2.18.3 unconditionally generates reader-property assertions and grpc-js
constructor assertions. Its documented configuration has no assertion-free codec
mode. The local patch changes the generator templates:

- All generated modules use one generated `WeakMap<BinaryReader, number>` for the
  existing decode recursion limit. `finally` restores state after successful or
  failed decoding.
- Numeric enum decoding keeps unknown numeric values, matching protobuf behavior.
- Repeated-field loops use their actual element types without non-null assertions.
- grpc-js services use a typed service definition and a real `Client` subclass.
  `streamList(request, options?)` and `streamList(request, metadata?, options?)`
  retain the same RPC path, serializers, metadata, options and streaming behavior.
  The current schema contains only server-streaming RPCs; adding another RPC kind
  fails generation until its typed template is implemented.
- Boolean checks preserve proto2 defaults and already satisfy the project's lint
  fixes, so running `fix` does not mutate generated output.

Supported options `useExactTypes=false` and `exportCommonSymbols=true` preserve
`.create`/`.fromPartial` and export their canonical `DeepPartial` type. Unused JSON
conversion helpers are disabled with `outputJsonMethods=false`; no project consumer
uses them. Binary encoding, integer range checks and the recursion limit remain
provided by the pinned generator and protobuf runtime.

The generation entry point runs the repository's AST rules explicitly on every
output, including files under `gen`. Assertions (`as const` and angle syntax
included), explicit `any`, non-null assertions, and lint/type suppression directives
fail generation. Check mode generates to a temporary directory and compares both
the file set and the exact contents. Tests additionally regenerate a recursive
proto2 fixture, exercise the AST guard, compare wire behavior with the independent
protobuf.js implementation, and run the real local grpc-js streaming fixtures.

Upstream references:

- [ts-proto options](https://github.com/stephenh/ts-proto/blob/main/README.markdown)
- [grpc-js streaming client implementation](https://github.com/grpc/grpc-node/blob/master/packages/grpc-js/src/client.ts)
- [Buf local plugin configuration](https://buf.build/docs/configuration/v2/buf-gen-yaml/)
