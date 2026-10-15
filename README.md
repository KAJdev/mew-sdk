# mew SDK

The `mew` CLI, the types for the SDK that mew injects into app frames, a local preview harness and example apps. Full documentation lives at https://mew.space/docs.

## Install

```sh
npm install --global mew-sdk
mew --version
```

This installs the `mew` CLI. Node 22 or newer is required. To run it without installing:

```sh
npx mew-sdk --help
```

Standalone binaries for Linux, macOS and Windows are attached to each [GitHub release](https://github.com/KAJdev/mew-sdk/releases) with `SHA256SUMS`, build provenance attestations and checksum-verifying `install.sh` and `install.ps1` scripts, for machines without Node:

```sh
curl -fsSL https://github.com/KAJdev/mew-sdk/releases/latest/download/install.sh | sh
```

## Use the CLI

```sh
mew init ./counter-app
mew dev ./counter-app
```

`mew dev` serves the app at http://127.0.0.1:4175 inside the same opaque sandbox document production uses, with in-memory state, a theme toggle and reload on save. Publishing, installing and the rest of the commands are described in [cli/README.md](cli/README.md).

## SDK types

```sh
npm install --save-dev mew-sdk
```

mew injects the SDK into each app frame as the global `mew`. The package gives editors and `tsc` its types:

```ts
/// <reference types="mew-sdk" />

const shared = await mew.state.get("shared");
await mew.state.put("shared", { expected_revision: shared.revision, value: { count: 1 } });
mew.theme.subscribe((theme) => console.log(theme.primary));
```

- `mew.state.get(scope)` returns `{ revision, value }` for `"private"` (this viewer) or `"shared"` (the whole installation). The manifest must grant the scope with `storage:private` or `storage:shared`.
- `mew.state.put(scope, { expected_revision, value })` replaces the whole JSON object (at most 16 KiB) when `expected_revision` matches and rejects otherwise. Read again before retrying.
- `mew.theme.get()` and `mew.theme.subscribe(listener)` expose the host colors, which are also live CSS variables: `--mew-primary`, `--mew-background`, `--mew-secondary` and `--mew-tertiary`.

An app is a single HTML document with inline scripts and styles. The frame is an opaque-origin sandbox without network access, so bundle anything you import into the document.

### Helpers

```ts
import { getMew, updateState, watchTheme } from "mew-sdk";

await updateState("shared", (value) => ({ count: Number(value.count ?? 0) + 1 }));
const stop = watchTheme((theme) => (document.body.dataset.primary = theme.primary));
```

`updateState` reads, applies your function and writes with the read revision, retrying from fresh state up to `attempts` times (default 3). `watchTheme` calls the listener with the current theme and on each change, and returns an unsubscribe function. `getMew` returns the injected SDK or throws outside an app frame.

### Local preview harness

```js
import { createDevServer } from "mew-sdk/dev";

const server = await createDevServer({ folder: "./my-app", port: 4175 });
console.log(server.url);
```

The folder needs an `app.json` with a relative `ui` path and `manifest.permissions`. The server listens on loopback only. `mew-sdk/document` exports the sandbox document and response policy generator, `mew-sdk/bootstrap.js` the frame bootstrap and `mew-sdk/sample.html` the counter example that `mew init` scaffolds.

## Examples

- `sample.html`: a shared counter and a private note, scaffolded by `mew init`.
- `examples/notes`: a private scratchpad. Preview it with `mew dev examples/notes`.

## License

MIT
