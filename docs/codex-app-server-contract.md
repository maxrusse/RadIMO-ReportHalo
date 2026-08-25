# Codex app-server contract used by RadimoAgent

The local Codex CLI is the authentication and model-session boundary. RadimoAgent does not implement or store ChatGPT credentials itself.

The client uses the documented app-server JSON-RPC methods exposed by the installed Codex binary:

- `initialize`
- `getAuthStatus`
- `model/list`
- `account/login/start` with `{ "type": "chatgpt" }`
- `account/logout`
- `thread/start`
- `turn/start`

The current generated v2 schema also defines `turn/start.input` items of type `localImage` with an absolute `path` and optional `detail`. RadimoAgent uses that shape only for an explicitly checked “Attach image to next turn” screen capture. The temporary PNG is deleted after `turn/completed`; if the runtime rejects the item, the UI must fall back to text/copy workflows rather than claiming that vision ran.

The browser-login response contains an `authUrl`. Completion arrives as the `account/login/completed` notification. The app only forwards safe login status to the renderer; it never requests `includeToken: true`, never exposes access tokens through the preload bridge, and does not expose device-code login.

Work turns remain read-only. Radiology discussion, differential, and conclusion turns enable read-only network access for source review; language-only correction turns keep network access disabled. The prompt still requires exact citations for sources actually accessed and forbids fabricated references.

The model list is queried at runtime rather than hardcoding an assumed catalog. The live development probe on 2026-08-22 exposed GPT-5.6 Luna, Terra, and Sol, with Luna selected as the initial default.
