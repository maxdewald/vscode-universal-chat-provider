<div align="center">

<img src="res/logo.png" width="132" alt="Universal Chat Provider logo" />

<h1>Universal Chat Provider</h1>

<p>
  <b>The VS&nbsp;Code extension that brings your Claude, ChatGPT&nbsp;/&nbsp;Codex, Antigravity, and more subscriptions into GitHub&nbsp;Copilot&nbsp;Chat</b><br/>
  <sub>No API key — just OAuth. <br/>…and use them to write your Git commit messages, too.</sub>
</p>

<p>
  <a href="https://marketplace.visualstudio.com/items?itemName=maxdewald.universal-chat-provider"><img src="https://vsmarketplacebadges.dev/version-short/maxdewald.universal-chat-provider.svg?label=Marketplace&color=654FF0" alt="VS Code Marketplace version" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=maxdewald.universal-chat-provider"><img src="https://vsmarketplacebadges.dev/installs-short/maxdewald.universal-chat-provider.svg?label=Installs&color=007ACC" alt="Marketplace installs" /></a>
  <img src="https://img.shields.io/badge/VS%20Code-1.124%2B-007ACC?logo=visualstudiocode&logoColor=white" alt="VS Code 1.124+" />
  <img src="https://img.shields.io/badge/license-MIT-3da639?logo=opensourceinitiative&logoColor=white" alt="MIT License" />
</p>

<p>
  <img src="https://img.shields.io/badge/Claude-D97757?logo=anthropic&logoColor=white" alt="Claude" />
  <img src="https://img.shields.io/badge/Codex-10A37F?logo=data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZmZmIiByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU%2BT3BlbkFJPC90aXRsZT48cGF0aCBkPSJNMjIuMjgxOSA5LjgyMTFhNS45ODQ3IDUuOTg0NyAwIDAgMC0uNTE1Ny00LjkxMDggNi4wNDYyIDYuMDQ2MiAwIDAgMC02LjUwOTgtMi45QTYuMDY1MSA2LjA2NTEgMCAwIDAgNC45ODA3IDQuMTgxOGE1Ljk4NDcgNS45ODQ3IDAgMCAwLTMuOTk3NyAyLjkgNi4wNDYyIDYuMDQ2MiAwIDAgMCAuNzQyNyA3LjA5NjYgNS45OCA1Ljk4IDAgMCAwIC41MTEgNC45MTA3IDYuMDUxIDYuMDUxIDAgMCAwIDYuNTE0NiAyLjkwMDFBNS45ODQ3IDUuOTg0NyAwIDAgMCAxMy4yNTk5IDI0YTYuMDU1NyA2LjA1NTcgMCAwIDAgNS43NzE4LTQuMjA1OCA1Ljk4OTQgNS45ODk0IDAgMCAwIDMuOTk3Ny0yLjkwMDEgNi4wNTU3IDYuMDU1NyAwIDAgMC0uNzQ3NS03LjA3Mjl6bS05LjAyMiAxMi42MDgxYTQuNDc1NSA0LjQ3NTUgMCAwIDEtMi44NzY0LTEuMDQwOGwuMTQxOS0uMDgwNCA0Ljc3ODMtMi43NTgyYS43OTQ4Ljc5NDggMCAwIDAgLjM5MjctLjY4MTN2LTYuNzM2OWwyLjAyIDEuMTY4NmEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4MjZhNC41MDQgNC41MDQgMCAwIDEtNC40OTQ1IDQuNDk0NHptLTkuNjYwNy00LjEyNTRhNC40NzA4IDQuNDcwOCAwIDAgMS0uNTM0Ni0zLjAxMzdsLjE0Mi4wODUyIDQuNzgzIDIuNzU4MmEuNzcxMi43NzEyIDAgMCAwIC43ODA2IDBsNS44NDI4LTMuMzY4NXYyLjMzMjRhLjA4MDQuMDgwNCAwIDAgMS0uMDMzMi4wNjE1TDkuNzQgMTkuOTUwMmE0LjQ5OTIgNC40OTkyIDAgMCAxLTYuMTQwOC0xLjY0NjR6TTIuMzQwOCA3Ljg5NTZhNC40ODUgNC40ODUgMCAwIDEgMi4zNjU1LTEuOTcyOFYxMS42YS43NjY0Ljc2NjQgMCAwIDAgLjM4NzkuNjc2NWw1LjgxNDQgMy4zNTQzLTIuMDIwMSAxLjE2ODVhLjA3NTcuMDc1NyAwIDAgMS0uMDcxIDBsLTQuODMwMy0yLjc4NjVBNC41MDQgNC41MDQgMCAwIDEgMi4zNDA4IDcuODcyem0xNi41OTYzIDMuODU1OEwxMy4xMDM4IDguMzY0IDE1LjExOTIgNy4yYS4wNzU3LjA3NTcgMCAwIDEgLjA3MSAwbDQuODMwMyAyLjc5MTNhNC40OTQ0IDQuNDk0NCAwIDAgMS0uNjc2NSA4LjEwNDJ2LTUuNjc3MmEuNzkuNzkgMCAwIDAtLjQwNy0uNjY3em0yLjAxMDctMy4wMjMxbC0uMTQyLS4wODUyLTQuNzczNS0yLjc4MThhLjc3NTkuNzc1OSAwIDAgMC0uNzg1NCAwTDkuNDA5IDkuMjI5N1Y2Ljg5NzRhLjA2NjIuMDY2MiAwIDAgMSAuMDI4NC0uMDYxNWw0LjgzMDMtMi43ODY2YTQuNDk5MiA0LjQ5OTIgMCAwIDEgNi42ODAyIDQuNjZ6TTguMzA2NSAxMi44NjNsLTIuMDItMS4xNjM4YS4wODA0LjA4MDQgMCAwIDEtLjAzOC0uMDU2N1Y2LjA3NDJhNC40OTkyIDQuNDk5MiAwIDAgMSA3LjM3NTctMy40NTM3bC0uMTQyLjA4MDVMOC43MDQgNS40NTlhLjc5NDguNzk0OCAwIDAgMC0uMzkyNy42ODEzem0xLjA5NzYtMi4zNjU0bDIuNjAyLTEuNDk5OCAyLjYwNjkgMS40OTk4djIuOTk5NGwtMi41OTc0IDEuNDk5Ny0yLjYwNjctMS40OTk3WiIvPjwvc3ZnPg==&logoColor=white" alt="Codex" />
  <img src="https://img.shields.io/badge/Antigravity-174EA6?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAA%2F1BMVEUAAAA0i%2BpOhulXnp8xiPLWX1CboVYxiPGZcJstje4ZfP0A%2F%2F9Spv9zsnIAAP%2BycGz1bGZvfMvHkzo9nrydtFPbbjxttW7%2FAAB4eq5ocfN%2Ff3%2B1qjyOwFVQp6vgVU5Vh%2B7%2F%2FwCyY2qCecIqcbgA%2FwDbVVTdbDxWhu7qbCm0pDzKlTgorbd%2F%2F39xcbidaqi0sj1xunNSq5pLp6P%2FAP9%2FfwCbcKfEhESju0OGhoaOwFb%2F%2F%2F%2BMwFbUlD8%2Fv3%2Bka56%2Ffz8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC38tR1AAAAQHRSTlMA6u3pn%2BHhX%2BQeBAEE7AHeDejV7xDSCAHgCQLo8guvVwEL7AMBaJmaGBm3FgIDGpCqUpQBAnDUtNxmAZUMBKEEGbxtBgAAAk9JREFUeNqNlmtX4jAYhKcQGpKUAFpgy01gRRBddV1ddd3L%2F%2F9Xm6RJG3qD%2BdBztPPknWnSU4AKxf%2F0dT3AebrWl9vfL8Bkco5%2FpdyPh4vD4WYP7M%2Fx3z7OZhdKo9HNACdjrVbxWzjTxGhkiJcTQDx9C41%2BdpRGy%2F2guUeMj7kHdDpLrJv899ex9YdhCnSaa4zx6fxh345oynSPfEDYt8S2ccTnPOz1HNC3LQb1WxzPe6lSoH%2BixRgfSP3tdvs9I7YNFZ6sW%2Bu927VEXe1fGOd2pa5WvyHTGPDsSl8ssq2t8NQ%2BBiyxnPyo8guMM2vLyBHdNaYVwALfrT0IUqA1HKbEa%2BWB%2BoNnazeyxFADfytbC6Htl0FQIDaKeEC5xRSLI79HbBTwUALudAXf7zXZvOJbRefny2N%2FRrSGelcLkliU%2FB6RlB7sAndBUAu0rkqZvoLkPsoYwBnNiV0JENPMTph5yOrCSUYkKrQvDpb5JThXdyXnAMkzRYVE1AFc8GwZnhG7AiCkq8DAvcE8cj2io0x5Iur7oZZ1za9kVPy%2FURIVy5GU2CHxdk0y4gIdRwUXzO5H5M1mbgAp%2BrPhheck3ADBS2cmYXbTuZDZQWWucVR%2BT7J%2B%2BV0eEbvFXKKKcLfN9ptNI6S0BcXe%2BQgBRogmKgN5oQgxK0rJqQFInd8RysTV8gLGr%2F6wCSskdQ3toTozo1QjDKL%2BsyEFT1elkfFTjYqmj59AolZVTpYCVDT79TuvomsnGNMY5KkvvhRmbZVcv7%2FinB8hqrD2pgnPkjlL%2FwH0WifRsOvc4wAAAABJRU5ErkJggg%3D%3D" alt="Antigravity" />
  <img src="https://img.shields.io/badge/Grok-202020?logo=x&logoColor=white" alt="Grok" />
  <img src="https://img.shields.io/badge/Kimi-000000?logo=moonshotai&logoColor=white" alt="Kimi" />
</p>

</div>

---

## Features

<table align="center">
  <tr>
    <td><b>🚀 Ready in minutes</b><br>Install, sign in, and start chatting.</td>
    <td><b>🔀 Native model picker</b><br>Choose your models directly in Copilot Chat.</td>
  </tr>
  <tr>
    <td><b>🧠 Reasoning built in</b><br>Pick the thinking effort and follow reasoning live.</td>
    <td><b>📊 Quota at a glance</b><br>See remaining usage before reaching a limit.</td>
  </tr>
  <tr>
    <td><b>✨ More than chat</b><br>Generate commit messages, titles, and summaries.</td>
    <td><b>👥 Multiple accounts</b><br>Add and manage several provider accounts.</td>
  </tr>
</table>

> [!WARNING]
> **Use entirely at your own risk and discretion.** This extension routes chat through your personal AI subscription accounts over OAuth. Accessing subscriptions outside their official apps may violate provider terms and could result in rate limiting or account suspension.

## Quick start

> Requires **VS Code 1.124+** and the **GitHub Copilot Chat** extension.

1. **Install** — get *Universal Chat Provider* from the **[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=maxdewald.universal-chat-provider)**. Prefer to build it yourself? See [Development](#development).
2. **Add an account** — accept the **Add Account** prompt (or run `Universal Chat Provider: Add Account`), pick a provider, and complete OAuth in your browser. Models refresh automatically.
3. **Chat** — open Copilot Chat and select a model under **Universal Chat Provider**.

Manage everything from the status bar item or the *Universal Chat Provider: Manage Provider* command — list/remove accounts, restart, update, or reset the managed server.

## Commit messages, titles, and summaries

Let your models write Copilot's commit messages, chat titles, and summaries. Run *Universal Chat Provider: Set Utility Model* (or use the status bar menu), pick a model (and thinking effort), done. Clear it to undo.

<details>
<summary>How it works</summary>

The command points Copilot's `chat.utilityModel` and `chat.utilitySmallModel` settings at your selected model, so those background flows run through your accounts. When the model supports thinking levels, the command also asks for the utility Thinking Effort; commit messages use `chat.utilitySmallModel` plus that effort. No Copilot subscription required.

</details>

## How it works

The extension runs [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) locally and registers its models with VS Code. Your subscriptions then appear directly in the Copilot Chat model picker.

```
   Your subscriptions          Local proxy             VS Code
  ┌────────────────────┐     ┌──────────────┐     ┌──────────────────┐
  │ Claude             │     │              │     │  Copilot Chat    │
  │ ChatGPT / Codex    │──┐  │              │  ┌─▶│   model picker   │
  │ Antigravity        │  ├─▶│  CLIProxyAPI │──┤  ├──────────────────┤
  │ Grok · Kimi · …    │──┘  │   (OAuth)    │  └─▶│  Utility model   │
  └────────────────────┘     └──────────────┘     └──────────────────┘
```

## Advanced

Managed-server updates are automatic by default. Change `universalChatProvider.server.updatePolicy` to `suggestUpdates` or `manual` if preferred.

<details>
<summary>Bring your own CLIProxyAPI server</summary>

Prefer to run CLIProxyAPI yourself, such as on a remote or shared machine?

1. Set `universalChatProvider.server.mode` to `external`.
2. Start CLIProxyAPI and complete the provider login there.
3. Use the **Import API Key** notification action when a local config is found, or run *Configure Connection* to enter the URL and key manually.

The API key is stored in VS Code `SecretStorage`. In external mode, the extension never starts or stops the server. If the server exposes a plaintext `remote-management.secret-key`, the **Add Account** and **Manage Accounts** commands work against it too.

</details>

<details>
<summary>Settings</summary>

<!-- configs -->

| Key                                           | Description                                                                        | Type      | Default                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------- | --------- | ------------------------- |
| ▿ <b>Connection</b>                           |
| `universalChatProvider.server.mode`           | How CLIProxyAPI is provided.                                                       | `string`  | `"managed"`               |
| `universalChatProvider.baseUrl`               | CLIProxyAPI server URL. Used only in external mode.                                | `string`  | `"http://127.0.0.1:8317"` |
| `universalChatProvider.configPath`            | Optional CLIProxyAPI config.yaml path for credential and model metadata discovery. | `string`  | `""`                      |
| `universalChatProvider.autoDetectConfig`      | Search common CLIProxyAPI config locations when no config path is set.             | `boolean` | `true`                    |
| ▿ <b>Managed Server</b>                       |
| `universalChatProvider.server.updatePolicy`   | How managed CLIProxyAPI updates are handled.                                       | `string`  | `"automatic"`             |
| `universalChatProvider.server.version`        | Exact CLIProxyAPI release used when update policy is Manual.                       | `string`  | `"7.2.5"`                 |
| ▿ <b>Status Bar</b>                           |
| `universalChatProvider.showQuotaWarnings`     | Warn in the status bar when the model in use is low on quota.                      | `boolean` | `true`                    |
| `universalChatProvider.quotaWarningThreshold` | Remaining-quota percent below which the status bar warning appears.                | `number`  | `10`                      |
| ▿ <b>Advanced</b>                             |
| `universalChatProvider.debug`                 | Show prompt-cache hit rate and write per-request diagnostics to extension storage. | `boolean` | `false`                   |

<!-- configs -->

</details>

<details>
<summary>Commands</summary>

<!-- commands -->

| Command                                  | Title                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `universalChatProvider.manage`           | Universal Chat Provider: Manage Provider                                             |
| `universalChatProvider.login`            | Universal Chat Provider: Add Account (Login)                                         |
| `universalChatProvider.manageAccounts`   | Universal Chat Provider: Manage Accounts                                             |
| `universalChatProvider.showQuota`        | Universal Chat Provider: Show Quota                                                  |
| `universalChatProvider.restartServer`    | Universal Chat Provider: Restart Managed Server                                      |
| `universalChatProvider.updateBinary`     | Universal Chat Provider: Update Proxy Binary                                         |
| `universalChatProvider.resetServer`      | Universal Chat Provider: Reset Managed Server                                        |
| `universalChatProvider.configure`        | Universal Chat Provider: Configure Connection                                        |
| `universalChatProvider.importConfig`     | Universal Chat Provider: Import API Key from Config                                  |
| `universalChatProvider.refresh`          | Universal Chat Provider: Refresh Models                                              |
| `universalChatProvider.setUtilityModel`  | Universal Chat Provider: Set Utility Model (commit messages, chat titles, summaries) |
| `universalChatProvider.clearCredentials` | Universal Chat Provider: Clear Stored API Key                                        |
| `universalChatProvider.showLogs`         | Universal Chat Provider: Show Logs                                                   |
| `universalChatProvider.showServerLogs`   | Universal Chat Provider: Show Server Output                                          |
| `universalChatProvider.openSettings`     | Universal Chat Provider: Open Settings                                               |

<!-- commands -->

</details>

## Development

```bash
pnpm install
pnpm vscode:dts
pnpm check          # lint + typecheck + tests + build
pnpm ext:package    # produce an installable .vsix
```

Press `F5` from VS Code Insiders to launch the Extension Development Host with the proposed APIs enabled.

## License

[MIT](./LICENSE.md) · Not affiliated with GitHub, OpenAI, Anthropic, or Google.
