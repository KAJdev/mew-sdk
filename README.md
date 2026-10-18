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
},
"home": "main"
```

- `page` is a channel tab.
- `panel` can be pinned by channel managers to one of its `anchors`.
- `message` renders app messages of its `message_type` inline in chat.
- `profile` shows on the owner's profile popout. It reads only the owner's `"profile"` state and cannot post or call.

`home` names the page widget that opens first. An app with page, panel, message or chatbar widgets must declare it, and `home` must name a page widget of the same manifest. An app made only of profile widgets has no home. When a person installs an app for themselves, mew creates a private app home that opens the home page directly, with no chat. `mew deploy` and the Workspace editor check `home` before building.

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
document.querySelector("#post-poll")?.addEventListener("click", () => {
  void mew.messages.post({ type: "poll", data: { question: "lunch?" }, content: "poll: lunch?" });
});
```

- `mew.state.watch(scope, listener)` delivers the current state and every later update with a higher revision. It returns an unsubscribe function.
- `mew.on("state" | "realtime" | "message" | "theme", listener)` subscribes to live events. A message widget receives `"message"` when its own message is edited.
- `mew.on("voice", listener)` receives safe, host-polled `VoiceRoom` metadata, not audio or playback confirmation. It returns an unsubscribe function.
- `mew.call(name, args)` runs a handler action and resolves to its result. Page, panel and message widgets can call.
- `mew.open(url)` opens an `http` or `https` link in a new tab during a trusted click or tap dispatch in the frame. Timers and synthetic clicks cannot open links. mew shows the link's domain and asks the user before opening. Clicks on `<a href="https://...">` links go through the same path, so plain links work without script. It throws on other schemes or URLs with credentials.
- `mew.messages.post({ type, data, content })` posts as the person using the app after a click or key press. `content` is the plain-text fallback shown wherever the widget cannot render. It needs the `messages:post` permission and a message widget for `type`.
- Message posts run synchronously inside a trusted click or keydown handler in a visible, active widget. Timers and synthetic events cannot post. Parked widgets receive host events but cannot issue requests until visibly reattached with unchanged authority. Widget posts always have the person as the author. Only handlers and bots post as the app, with `messages:post_as_app`, and an installation can store at most 30 app-authored messages per minute; rejected or retried posts use none of that allowance. Posts for one installation run one at a time; a post that finds the installation still busy after about a second fails with `429` and uses none of the allowance.
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

## Provider players

Widgets can call `mew.media.open({provider, kind, id})` after declaring `media:youtube` or `media:spotify`. YouTube supports video and playlist IDs; Spotify supports track, album, playlist, episode and show IDs. The trusted host validates the target, asks the viewer before loading a provider, and returns `{status: "opened" | "cancelled" | "unsupported"}`. Opened describes frame creation, not playback success. `mew.media.supported` reports host capability; native wrappers and the local development host report unsupported.

Provider code has no widget bridge, state or mew token. The app's opaque, network-denied sandbox remains intact. Players are destroyed when the owning surface/session/access ends. Playback depends on provider/browser/account restrictions; the host always offers an official-link action. No autoplay, fullscreen, picture-in-picture, casting, background playback or provider account linking is supplied. See [the SDK guide](https://mew.space/docs/sdk#provider-players) for exact IDs, consent and authority behavior.

## Voice and streaming

Declare `voice:read` for metadata, add `voice:connect` for human connection/receiving, and add `voice:publish` for microphone, camera or screen publication. Every dependency must appear in both the manifest and current installation grant. Voice applies to ordinary channel installations, not DMs, personal installs or app homes. `mew.voice.supported` reports host capability; native embedded voice capabilities report `false`, not a permission grant.

| Call | Result |
| --- | --- |
| `mew.voice.get()` | `VoiceRoom`: installation/channel IDs and revision, `enabled`, safe `participants`, capability flags and `activity` or `null`. |
| `mew.voice.streams(cursor?)` | `{ streams: VoiceStream[], next_cursor: string | null }`; requires a live human call in the same channel and `voice:read`. |
| `mew.voice.join()` | `{ status: "joined", actor: "human", participant_id }` or `{ status: "cancelled" | "unsupported" }`. |
| `mew.voice.leave()` | `{ status: "left" }` or `{ status: "cancelled" | "unsupported" }`. |
| `mew.voice.publish({ kind, audio? })` | `{ status: "published", handle, kind, role: "publication" }` or cancelled/unsupported. |
| `mew.voice.subscribe({ stream_id, revision })` | `{ status: "subscribed", handle, kind, role: "subscription" }` or cancelled/unsupported. |
| `mew.voice.stop(handle)` | `undefined` after app-owned stream cleanup. |
| `mew.voice.activity.get()` | `VoiceActivity` or `null`. |
| `mew.voice.activity.join()` | `{ status: "joined", activity }` or cancelled/unsupported. |
| `mew.voice.activity.leave()` | `undefined`; leaves watching, not the human call. |
| `mew.voice.activity.control(command)` | The resulting `VoiceActivity`; conflicts reject. |

Failures can reject. Human join/leave, capture and receiving use trusted host confirmations. A new call starts muted, reusing a same-channel call does not expose its microphone, and another channel's call is not silently taken over. Capture kinds are `microphone`, `camera` and `screen`; only screen accepts `audio`, with a separate host screen-audio choice. Streams play only through trusted local controls. The widget never gets tokens, credentials, SDP, TURN data, device lists or `MediaStream` objects.

Choose subscription references from a real inventory page after joining, not hardcoded IDs:

```js
const page = await mew.voice.streams();
for (const stream of page.streams) {
  const button = document.createElement("button");
  button.textContent = `receive ${stream.kind}`;
  button.addEventListener("click", () => {
    void mew.voice.subscribe({ stream_id: stream.stream_id, revision: stream.revision });
  });
  document.body.append(button);
}
```

`VoiceStream` exposes `stream_id`, `revision`, `kind`, `actor: { type: "human", user_id, participant_id, installation_id }` and `tracks: [{ mid, kind: "audio" | "video" }]`. Pass each non-null `next_cursor` unchanged to `streams(next_cursor)`, even after an empty page. These are safe metadata, not SFU selectors or raw tracks. `VoiceParticipant`, `VoiceRoom`, `VoiceStream`, `VoiceStreamHandle`, `VoiceActivity` and `VoiceActivityCommand` are exported types.

Shared YouTube requires `voice:read`, `voice:connect`, `media:youtube`, a current human voice participant and explicit watch consent. Each viewer uses an official player independently and chooses local follow/play and output volume. A watcher can claim unclaimed controls; the controller or a watching channel owner/site admin can manage the queue. Commands carry `room_instance` and `expected_revision`, plus `op`: `claim`, `enqueue` (`video_id`), `select`/`remove` (`index`), `play`, `pause`, `seek` (`position_seconds`) or `transfer` (`participant_id`). Read fresh state after conflicts. Polled server time/position anchors describe shared intent, not actual local playback; provider/browser restrictions and playback errors remain possible. No media extraction, rebroadcast, RTC provider capture, background autoplay, picture-in-picture, fullscreen or casting is supplied.

Host resources follow the current account, installation revision, visible surface and human room authority. Closing/hiding stops local streams; late capture/allocation results are cleaned up, not attached to another session. Stream-stop cleanup retains the original actor/handle after panel disposal and retries transient failures with backoff until acknowledged or invalidated; stop can reject while cleanup is pending. Owned watch leave uses an internal lifetime UUID to remove only that original participant's handle without a current app grant or global revision match. A durable ownership tombstone fences delayed joins; the UUID is not exposed in snapshots or SDK arguments. Cleanup stays bound to the original call. Page crashes rely on server leases/audits, not a fixed outage-cleanup deadline. Real tracks reuse the generic Cloudflare SFU; no persistent bot is created. See [the voice guide](https://mew.space/docs/sdk#voice-and-streaming) and [host-only REST protocol](https://mew.space/docs/api#voice).

## Weather maps

Declare `maps:ventusky`, then call `mew.weather.open({ latitude, longitude, zoom?, layer })`. Latitude and longitude must be finite and within `[-90, 90]` and `[-180, 180]`; zoom is an integer `1` through `10`, default `7`. Layers are exactly `temperature-2m`, `rain-3h` or `wind-10m`. The trusted host constructs the official Ventusky iframe URL with only coordinates/zoom and layer. No model, time, pin, arbitrary query, private label, geolocation, credentials or paid API is supported. Units and language use provider defaults.

The host shows the exact coordinates and asks before any provider contact. Loading the map or opening its official link shares coordinates, zoom, layer and IP address with Ventusky and its services; provider cookies may apply. The official iframe retains attribution and interactive controls. The result is `{ status: "opened" | "cancelled" | "unsupported", url }`; `opened` means iframe attachment, not successful map rendering. `mew.weather.supported` is `false` on native hosts, which offer only an explicit official link.

Provider experiences use a separate one-use trusted-parent broker with a private session-bound port. Widgets keep their opaque origin, CSP and network denial; arbitrary remote URLs and HTML are not bridge inputs. Closing/hiding the surface or losing current authority destroys the frame. See [weather maps](https://mew.space/docs/sdk#weather-maps).

These descriptions are source contracts, not proof of two-human streaming, complete provider playback or native-build functionality. Source checks are not end-to-end verification.

## Examples

- `sample.html`: a shared counter and a private note, scaffolded by `mew init`.
- `examples/notes`: a private scratchpad. Preview it with `mew dev examples/notes`.

## License

MIT
