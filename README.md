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

- `mew.state.get(scope)` returns `{ revision, value, state_version }` for `"private"` (this viewer), `"shared"` (the whole installation) or `"profile"` (the owner's public profile data, on their personal installation). The manifest must grant `private` and `shared` with `storage:private` or `storage:shared`.
- `mew.state.put(scope, { expected_revision, value })` replaces the whole JSON object (at most 16 KiB) when `expected_revision` matches and rejects otherwise. Read again before retrying.
- `state_version` is the manifest `state_version` of the app version that last wrote the value, or `null` when nothing has been written. Installations follow the latest published version and stored state is kept as-is across versions, so new code can detect an older shape and upgrade it on its next write.
- `mew.theme.get()` and `mew.theme.subscribe(listener)` expose the host colors, which are also live CSS variables: `--mew-primary`, `--mew-background`, `--mew-secondary` and `--mew-tertiary`.

The frame is an opaque-origin sandbox without network access, so bundle anything you import into the widget.

### Widgets

An app declares named widgets in its manifest, each of one type:

```json
"widgets": {
  "main": { "type": "page", "title": "polls" },
  "pinned": { "type": "panel", "anchors": ["top", "right"] },
  "poll": { "type": "message", "message_type": "poll", "max_height": 320 },
  "card": { "type": "profile", "height": 140 }
}
```

- `page` is a channel tab.
- `panel` can be pinned by channel managers to one of its `anchors`.
- `message` renders app messages of its `message_type` inline in chat.
- `profile` shows on the owner's profile popout. It reads only the owner's `"profile"` state and cannot post or call.

Each widget ships as `{ js, css, html }`. The frame builds the `html` body, then a style element from `css`, then runs `js` as a module.

`mew.context` describes where the frame is running:

| widget | context |
| --- | --- |
| page | `{ installation_id, widget, viewer: { id, username } }` |
| panel | `{ installation_id, widget, viewer, anchor }` |
| message | `{ installation_id, widget, viewer, message: { id, type, data, content, author_id, created_at } }` |
| profile | `{ installation_id, widget, viewer: { is_owner } }` |

```ts
mew.state.watch("shared", ({ revision, value }) => render(value));
mew.on("message", (message) => render(message.data));
mew.on("realtime", ({ topic, data }) => console.log(topic, data));
const result = await mew.call("vote", { option: 1 });
await mew.messages.post({ type: "poll", data: { question: "lunch?" }, content: "poll: lunch?" });
```

- `mew.state.watch(scope, listener)` delivers the current state and every later update with a higher revision. It returns an unsubscribe function.
- `mew.on("state" | "realtime" | "message" | "theme", listener)` subscribes to live events. A message widget receives `"message"` when its own message is edited.
- `mew.call(name, args)` runs a handler action and resolves to its result. Page, panel and message widgets can call.
- `mew.messages.post({ type, data, content })` posts an app message as the current user after a click or key press. `content` is the plain-text fallback shown wherever the widget cannot render. It needs the `messages:post` permission and a message widget for `type`.
- Message and profile widgets size to their content. `mew.frame.setHeight(px)` sets the height explicitly.

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

## Message embeds

`Embed`, `CompactEmbed`, `RichEmbed` and `MessagePayload` are exported types from `mew-sdk` and `mew-sdk/handler`. Messages accept at most 10 discriminated embeds. Compact rows use `type: "compact"`, nonblank `content` of up to 1024 Unicode code points, optional HTTP(S) `link` of up to 2048 characters, optional `#RRGGBB` `color`, and optional `badge: { text }` of up to 32 characters. Badge text is a content label, never trusted identity. URLs cannot contain credentials, whitespace or control characters. Compact text occupies one line with a full-text expansion control and supports safe inline Markdown, not HTML or images.

```ts
import type { MessagePayload } from "mew-sdk";

const payload: MessagePayload = {
  embeds: [{ type: "compact", content: "**Search** finds messages across channels.", badge: { text: "Improved" } }],
};
```

Send this body through an authorized message endpoint or an incoming channel webhook. Hosted handlers can attach `embeds` to a declared widget post with `ctx.mew.messages.post({ type, data, content, embeds })`; widget type, fallback content, installation scope and `messages:post_as_app` remain required. The frame SDK's widget-post contract is separate. Rich embeds use `type: "rich"` with optional `title`, `description`, `footer`, `color`, `url`, `image_url`, `video_url` and `audio_url` fields. See [message embeds](https://mew.space/docs/embeds) for limits and examples.

## Examples

- `sample.html`: a shared counter and a private note, scaffolded by `mew init`.
- `examples/notes`: a private scratchpad. Preview it with `mew dev examples/notes`.

## License

MIT
