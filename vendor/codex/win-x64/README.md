# Windows Codex payload

This directory contains the official OpenAI Codex `0.149.0` Windows x64 binary:

```text
SHA-256: 14b7e6b2356e82d1d9275579eaa588757b4e0a501b65dcc19fccdf77bd83dc00
Source: https://github.com/openai/codex/releases/tag/rust-v0.149.0
```

For a future refresh, place the approved Windows `codex.exe` binary in this directory before running:

```text
npm run dist:win
```

The build copies it to `resources/codex/codex.exe`. This repository does not modify the shared Codex installation automatically.
