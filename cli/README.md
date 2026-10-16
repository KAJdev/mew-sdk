# mew CLI

Create, preview, publish and install mew apps. Installation is described in the [repository README](../README.md); full documentation lives at https://mew.space/docs.

```sh
mew init ./counter-app
mew dev ./counter-app
```

`mew dev` serves the app at http://127.0.0.1:4175 inside the same opaque sandbox document production uses, with in-memory state, a theme toggle and reload on save. Pass `--port` to choose another port.

## Publishing

```sh
export MEW_TOKEN='your-account-token'
mew deploy ./counter-app
```

`MEW_API_URL` is the API base before `/v1` and defaults to `https://api.mew.space/api`. Remote bases require HTTPS; plain HTTP is accepted only for literal loopback addresses. Account tokens stay in the environment and are never written into app files, bundles or output, and the CLI does not follow redirects with credentials. A broad account token is not a scoped CI credential, so keep it out of shared CI.

`app.json` holds app metadata, `app_id` after creation, `expected_version`, the version 1 manifest and relative `ui` and optional `handler` paths. The UI is one HTML document and the handler is bundled ESM JavaScript; TypeScript authors compile to those artifacts first. Artifact paths stay inside the app folder. Publication stores source and does not activate hosted handlers.

Each successful deployment advances `expected_version` in `app.json`. A conflict means another publication changed the head: use `mew inspect` and review that release before deliberately updating the local version. A failed publication keeps its app identity, so retrying does not create another app.

## Widget projects

An `app.json` with `widgets` is a project folder. Each widget has a `type` (`page`, `panel`, `message` or `profile`), an `entry` (TypeScript or JavaScript) and/or an `html` template, plus type options. One optional `handler` entry exports a `new App()` from `mew-sdk/handler`. `mew deploy` bundles every entry with esbuild, including CSS, assets and npm dependencies from the folder's `node_modules`, reads the handler's registrations and publishes one version. Bundling needs the npm package (`npm i -g mew-sdk`).

```json
{
  "name": "polls",
  "expected_version": 0,
  "permissions": ["storage:shared", "messages:post"],
  "widgets": {
    "dashboard": { "type": "page", "title": "Polls", "entry": "src/dashboard.ts" },
    "poll": { "type": "message", "message_type": "poll", "max_height": 320, "entry": "src/poll.ts" }
  },
  "handler": "src/backend.ts"
}
```

`mew-sdk/build` exports the same `buildProject` the CLI uses, so other tools produce identical versions.

## Installing

Installation requires explicit permission acceptance:

```sh
export MEW_ACCEPT_PERMISSIONS='storage:private,storage:shared'
mew install APP_ID personal
```

`personal` atomically creates a private channel and installs the app there. A channel ID targets a channel you are allowed to manage. The permission list must match the app's current permissions exactly.

Installations always run the app's latest published version. When a new version requests only permissions the installation already has, the installation moves to it automatically. When it requests more, the installation keeps running its current version and records `pending_permissions` until the channel owner, a site administrator or the owner of a personal installation approves them:

```sh
export MEW_ACCEPT_PERMISSIONS='storage:private,storage:shared'
mew approve INSTALLATION_ID
```

`approve` reads the installation, requires `MEW_ACCEPT_PERMISSIONS` to match its pending permissions exactly and submits a revision-checked approval. App code can read its granted private and shared state and may disclose it externally; consent never gives it account credentials or control of the trusted application shell.

`disable` stops installation state access. `uninstall` deletes installation state while keeping the channel. Both read the current installation revision and submit a revision-checked change. `state` reads your private state or authorized shared state.

`list`, `catalog` and `installations CHANNEL_ID` return one bounded page as `{items,next_cursor}`. Pass `--after CURSOR` to request the next page. Rerun without a cursor for the first page, or reuse an earlier cursor to go back. The CLI never walks all pages automatically.

## Local handlers

`mew dev <folder> <event.json>` invokes an operator-owned handler with a trusted fixture event. It needs `app-runtime/` from a checkout of the main mew repository and a local Docker daemon:

```sh
docker build -t mew-app-runtime:local app-runtime/
node mew-sdk/cli/bin/mew.js dev ./counter-app ./event.json
```

This is a local development adapter, not managed execution of marketplace code. Hosted jobs, app secrets, managed logs and scoped CI credentials are not part of this release.
