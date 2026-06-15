# Universal Chat Provider

A VS Code extension that exposes the chat-capable models from a local
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) server in GitHub
Copilot Chat, and reuses those models to generate Git commit messages.

## Layout

- `src/chat/` — the language-model chat provider: model registry, requests, completion.
- `src/cliproxy/` — talks to CLIProxyAPI (client, SSE, credentials, and the `managed/` server lifecycle).
- `src/commit/` — commit-message generation from the SCM input box.
- `src/extension/` — activation, commands, menus, status bar.
- `src/shared/` — small cross-cutting helpers.

## Rules

- Add comments only when absolutely necessary. Code and variable names should
  explain intent on their own; reach for a comment only when something cannot be
  made clear through naming and structure.
