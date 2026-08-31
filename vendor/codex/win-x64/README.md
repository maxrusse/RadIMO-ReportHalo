# Windows Codex payload

This directory contains the official OpenAI Codex `0.149.0` Windows x64 binary:

```text
SHA-256: 14b7e6b2356e82d1d9275579eaa588757b4e0a501b65dcc19fccdf77bd83dc00
Source: https://github.com/openai/codex/releases/tag/rust-v0.149.0
```

For a local development override, place the approved Windows `codex.exe` binary in this directory. The release build does not require or embed this ignored file; it uses the external official Codex installer path instead.

```text
npm run preflight:win
```

The preflight verifies its SHA-256 against `codex-runtime.json`. This repository does not modify the shared Codex installation automatically.
