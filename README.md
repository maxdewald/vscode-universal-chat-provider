<div align="center">

<img src="images/logo.png" width="132" alt="Universal Chat Provider logo" />

<h1>Universal Chat Provider</h1>

<p>
  <b>The VS&nbsp;Code extension that brings your Claude, ChatGPT&nbsp;/&nbsp;Codex, Antigravity, and more subscriptions into GitHub&nbsp;Copilot&nbsp;Chat</b><br/>
  <sub>No API key — just OAuth. <br/>…and use them to write your Git commit messages, too.</sub>
</p>

<p>
  <a href="https://marketplace.visualstudio.com/items?itemName=maxdewald.universal-chat-provider"><img src="https://vsmarketplacebadges.dev/version-short/maxdewald.universal-chat-provider.svg?label=Marketplace&color=654FF0" alt="VS Code Marketplace version" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=maxdewald.universal-chat-provider"><img src="https://vsmarketplacebadges.dev/installs-short/maxdewald.universal-chat-provider.svg?label=Installs&color=007ACC" alt="Marketplace installs" /></a>
  <img src="https://img.shields.io/badge/VS%20Code-1.131%2B-007ACC?logo=visualstudiocode&logoColor=white" alt="VS Code 1.131+" />
  <img src="https://img.shields.io/badge/license-MIT-3da639?logo=opensourceinitiative&logoColor=white" alt="MIT License" />
</p>

<p>
  <img src="https://img.shields.io/badge/Claude-D97757?logo=claude&logoColor=white" alt="Claude" />
  <img src="https://img.shields.io/badge/Codex-10A37F?logo=data:image/svg+xml;base64,PHN2ZyBmaWxsPSIjZmZmIiByb2xlPSJpbWciIHZpZXdCb3g9IjAgMCAyNCAyNCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGl0bGU%2BT3BlbkFJPC90aXRsZT48cGF0aCBkPSJNMjIuMjgxOSA5LjgyMTFhNS45ODQ3IDUuOTg0NyAwIDAgMC0uNTE1Ny00LjkxMDggNi4wNDYyIDYuMDQ2MiAwIDAgMC02LjUwOTgtMi45QTYuMDY1MSA2LjA2NTEgMCAwIDAgNC45ODA3IDQuMTgxOGE1Ljk4NDcgNS45ODQ3IDAgMCAwLTMuOTk3NyAyLjkgNi4wNDYyIDYuMDQ2MiAwIDAgMCAuNzQyNyA3LjA5NjYgNS45OCA1Ljk4IDAgMCAwIC41MTEgNC45MTA3IDYuMDUxIDYuMDUxIDAgMCAwIDYuNTE0NiAyLjkwMDFBNS45ODQ3IDUuOTg0NyAwIDAgMCAxMy4yNTk5IDI0YTYuMDU1NyA2LjA1NTcgMCAwIDAgNS43NzE4LTQuMjA1OCA1Ljk4OTQgNS45ODk0IDAgMCAwIDMuOTk3Ny0yLjkwMDEgNi4wNTU3IDYuMDU1NyAwIDAgMC0uNzQ3NS03LjA3Mjl6bS05LjAyMiAxMi42MDgxYTQuNDc1NSA0LjQ3NTUgMCAwIDEtMi44NzY0LTEuMDQwOGwuMTQxOS0uMDgwNCA0Ljc3ODMtMi43NTgyYS43OTQ4Ljc5NDggMCAwIDAgLjM5MjctLjY4MTN2LTYuNzM2OWwyLjAyIDEuMTY4NmEuMDcxLjA3MSAwIDAgMSAuMDM4LjA1MnY1LjU4MjZhNC41MDQgNC41MDQgMCAwIDEtNC40OTQ1IDQuNDk0NHptLTkuNjYwNy00LjEyNTRhNC40NzA4IDQuNDcwOCAwIDAgMS0uNTM0Ni0zLjAxMzdsLjE0Mi4wODUyIDQuNzgzIDIuNzU4MmEuNzcxMi43NzEyIDAgMCAwIC43ODA2IDBsNS44NDI4LTMuMzY4NXYyLjMzMjRhLjA4MDQuMDgwNCAwIDAgMS0uMDMzMi4wNjE1TDkuNzQgMTkuOTUwMmE0LjQ5OTIgNC40OTkyIDAgMCAxLTYuMTQwOC0xLjY0NjR6TTIuMzQwOCA3Ljg5NTZhNC40ODUgNC40ODUgMCAwIDEgMi4zNjU1LTEuOTcyOFYxMS42YS43NjY0Ljc2NjQgMCAwIDAgLjM4NzkuNjc2NWw1LjgxNDQgMy4zNTQzLTIuMDIwMSAxLjE2ODVhLjA3NTcuMDc1NyAwIDAgMS0uMDcxIDBsLTQuODMwMy0yLjc4NjVBNC41MDQgNC41MDQgMCAwIDEgMi4zNDA4IDcuODcyem0xNi41OTYzIDMuODU1OEwxMy4xMDM4IDguMzY0IDE1LjExOTIgNy4yYS4wNzU3LjA3NTcgMCAwIDEgLjA3MSAwbDQuODMwMyAyLjc5MTNhNC40OTQ0IDQuNDk0NCAwIDAgMS0uNjc2NSA4LjEwNDJ2LTUuNjc3MmEuNzkuNzkgMCAwIDAtLjQwNy0uNjY3em0yLjAxMDctMy4wMjMxbC0uMTQyLS4wODUyLTQuNzczNS0yLjc4MThhLjc3NTkuNzc1OSAwIDAgMC0uNzg1NCAwTDkuNDA5IDkuMjI5N1Y2Ljg5NzRhLjA2NjIuMDY2MiAwIDAgMSAuMDI4NC0uMDYxNWw0LjgzMDMtMi43ODY2YTQuNDk5MiA0LjQ5OTIgMCAwIDEgNi42ODAyIDQuNjZ6TTguMzA2NSAxMi44NjNsLTIuMDItMS4xNjM4YS4wODA0LjA4MDQgMCAwIDEtLjAzOC0uMDU2N1Y2LjA3NDJhNC40OTkyIDQuNDk5MiAwIDAgMSA3LjM3NTctMy40NTM3bC0uMTQyLjA4MDVMOC43MDQgNS40NTlhLjc5NDguNzk0OCAwIDAgMC0uMzkyNy42ODEzem0xLjA5NzYtMi4zNjU0bDIuNjAyLTEuNDk5OCAyLjYwNjkgMS40OTk4djIuOTk5NGwtMi41OTc0IDEuNDk5Ny0yLjYwNjctMS40OTk3WiIvPjwvc3ZnPg==&logoColor=white" alt="Codex" />
  <img src="https://img.shields.io/badge/Antigravity-174EA6?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAA%2F1BMVEUAAAA0i%2BpOhulXnp8xiPLWX1CboVYxiPGZcJstje4ZfP0A%2F%2F9Spv9zsnIAAP%2BycGz1bGZvfMvHkzo9nrydtFPbbjxttW7%2FAAB4eq5ocfN%2Ff3%2B1qjyOwFVQp6vgVU5Vh%2B7%2F%2FwCyY2qCecIqcbgA%2FwDbVVTdbDxWhu7qbCm0pDzKlTgorbd%2F%2F39xcbidaqi0sj1xunNSq5pLp6P%2FAP9%2FfwCbcKfEhESju0OGhoaOwFb%2F%2F%2F%2BMwFbUlD8%2Fv3%2Bka56%2Ffz8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC38tR1AAAAQHRSTlMA6u3pn%2BHhX%2BQeBAEE7AHeDejV7xDSCAHgCQLo8guvVwEL7AMBaJmaGBm3FgIDGpCqUpQBAnDUtNxmAZUMBKEEGbxtBgAAAk9JREFUeNqNlmtX4jAYhKcQGpKUAFpgy01gRRBddV1ddd3L%2F%2F9Xm6RJG3qD%2BdBztPPknWnSU4AKxf%2F0dT3AebrWl9vfL8Bkco5%2FpdyPh4vD4WYP7M%2Fx3z7OZhdKo9HNACdjrVbxWzjTxGhkiJcTQDx9C41%2BdpRGy%2F2guUeMj7kHdDpLrJv899ex9YdhCnSaa4zx6fxh345oynSPfEDYt8S2ccTnPOz1HNC3LQb1WxzPe6lSoH%2BixRgfSP3tdvs9I7YNFZ6sW%2Bu927VEXe1fGOd2pa5WvyHTGPDsSl8ssq2t8NQ%2BBiyxnPyo8guMM2vLyBHdNaYVwALfrT0IUqA1HKbEa%2BWB%2BoNnazeyxFADfytbC6Htl0FQIDaKeEC5xRSLI79HbBTwUALudAXf7zXZvOJbRefny2N%2FRrSGelcLkliU%2FB6RlB7sAndBUAu0rkqZvoLkPsoYwBnNiV0JENPMTph5yOrCSUYkKrQvDpb5JThXdyXnAMkzRYVE1AFc8GwZnhG7AiCkq8DAvcE8cj2io0x5Iur7oZZ1za9kVPy%2FURIVy5GU2CHxdk0y4gIdRwUXzO5H5M1mbgAp%2BrPhheck3ADBS2cmYXbTuZDZQWWucVR%2BT7J%2B%2BV0eEbvFXKKKcLfN9ptNI6S0BcXe%2BQgBRogmKgN5oQgxK0rJqQFInd8RysTV8gLGr%2F6wCSskdQ3toTozo1QjDKL%2BsyEFT1elkfFTjYqmj59AolZVTpYCVDT79TuvomsnGNMY5KkvvhRmbZVcv7%2FinB8hqrD2pgnPkjlL%2FwH0WifRsOvc4wAAAABJRU5ErkJggg%3D%3D" alt="Antigravity" />
  <img src="https://img.shields.io/badge/Kimi-000000?logo=moonshotai&logoColor=white" alt="Kimi" />
  <img src="https://img.shields.io/badge/Grok-202020?logo=x&logoColor=white" alt="Grok" />
  <img src="https://img.shields.io/badge/Devin-000000?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyNCAyNCcgZmlsbD0nd2hpdGUnPjxwYXRoIGQ9J00yLjAzMyA5Ljg2N2wyLjU1NCAxLjQ4M2EuNTg5LjU4OSAwIDAwLjU5MiAwbDIuNTU0LTEuNDgzLjAxLS4wMDhhLjYwOC42MDggMCAwMC4xMS0uMDg0bC4wMTMtLjAxNWEuNjMxLjYzMSAwIDAwLjA3Ni0uMWMuMDAzLS4wMDUuMDA4LS4wMS4wMS0uMDE2YS41NTguNTU4IDAgMDAuMDUyLS4xMjVsLjAwNy0uMDI4YS42MTEuNjExIDAgMDAuMDE5LS4xNFY3Ljg2OGMwLS41NzIuMzA3LTEuMTA1LjgtMS4zOTJhMS41OTUgMS41OTUgMCAwMTEuNTk4IDBsMS4yNzcuNzQyYS41NC41NCAwIDAwLjEyOS4wNTNsLjAyOC4wMWMuMDQ0LjAxLjA4OC4wMTUuMTMzLjAxNmguMDA2bC4wMTMtLjAwMmEuNTg3LjU4NyAwIDAwLjI3LS4wNzRsLjAxMS0uMDA0IDIuNTU0LTEuNDgzYS41OTYuNTk2IDAgMDAuMjk3LS41MTZWMi4yNTNhLjU5NS41OTUgMCAwMC0uMjk3LS41MTZMMTIuMjkzLjI1N2EuNTg3LjU4NyAwIDAwLS41OTEgMEw5LjE0OCAxLjczN2wtLjAxLjAxYS42MDkuNjA5IDAgMDAtLjEwOS4wODNsLS4wMTQuMDE1YS42MzIuNjMyIDAgMDAtLjA3Ni4xYy0uMDAzLjAwNS0uMDA4LjAxLS4wMS4wMTZhLjU3LjU3IDAgMDAtLjA1Mi4xMjRsLS4wMDcuMDI4YS42MTIuNjEyIDAgMDAtLjAxOC4xNHYxLjQ4M2MwIC41NzItLjMwNyAxLjEwNS0uOCAxLjM5M2ExLjU5NyAxLjU5NyAwIDAxLTEuNTk5IDBsLTEuMjc2LS43NDJhLjYwMy42MDMgMCAwMC0uMTMtLjA1M2wtLjAyOC0uMDA4YS42NTguNjU4IDAgMDAtLjEzMy0uMDE4aC0uMDJhLjU3LjU3IDAgMDAtLjI2OS4wNzRjLS4wMDMuMDAyLS4wMDguMDAyLS4wMTIuMDA1TDIuMDMzIDUuODcyYS41OTYuNTk2IDAgMDAtLjI5Ny41MTV2Mi45NjZjMCAuMjEzLjExMy40MS4yOTcuNTE1eicvPjxwYXRoIGQ9J00xNS45NDMgMTAuNjA3YTEuNTk2IDEuNTk2IDAgMDExLjU5OSAwbDEuMjc2Ljc0Yy4wNDEuMDI1LjA4NS4wNC4xMy4wNTVsLjAyOC4wMDhjLjA0My4wMS4wODguMDE2LjEzMy4wMThoLjAwNWMuMDA1IDAgLjAxLS4wMDIuMDE0LS4wMDNhLjQ3NC40NzQgMCAwMC4xMjItLjAxNmwuMDIxLS4wMDVhLjYxNi42MTYgMCAwMC4xMjYtLjA1MmMuMDA0LS4wMDIuMDA5LS4wMDIuMDEzLS4wMDVsMi41NTQtMS40ODJhLjU5Ny41OTcgMCAwMC4yOTctLjUxNlY2LjM4M2EuNTk2LjU5NiAwIDAwLS4yOTctLjUxNWwtMi41NTItMS40ODNhLjU4Ny41ODcgMCAwMC0uNTkyIDBsLTIuNTUzIDEuNDgyLS4wMTEuMDA4YS42MS42MSAwIDAwLS4xMDguMDg0bC0uMDE0LjAxNmEuNjM3LjYzNyAwIDAwLS4wNzYuMWMtLjAwMy4wMDUtLjAwOC4wMS0uMDEuMDE2YS41Ny41NyAwIDAwLS4wNTIuMTI0bC0uMDA3LjAyOWEuNjEyLjYxMiAwIDAwLS4wMTguMTR2MS40ODJjMCAuNTcyLS4zMDcgMS4xMDUtLjggMS4zOTNhMS41OTcgMS41OTcgMCAwMS0xLjU5OSAwbC0xLjI3Ni0uNzQyYS41ODQuNTg0IDAgMDAtLjEzLS4wNTNsLS4wMjgtLjAwOGEuNjIuNjIgMCAwMC0uMTMzLS4wMThoLS4wMmEuNTg3LjU4NyAwIDAwLS4yNjkuMDc0bC0uMDEyLjAwNEw5LjE1IDEwYS41OTYuNTk2IDAgMDAtLjI5Ni41MTZ2Mi45NjZjMCAuMjEyLjExMi40MDkuMjk2LjUxNWwyLjU1NCAxLjQ4M3MuMDA4LjAwMi4wMTIuMDA1Yy4wNC4wMjIuMDgyLjA0LjEyNi4wNTJsLjAyLjAwNGEuNTcuNTcgMCAwMC4xMjMuMDE3bC4wMTQuMDAyaC4wMDZjLjA1NCAwIC4xMDgtLjAxLjE2LS4wMjVhLjU4Ny41ODcgMCAwMC4xMy0uMDU0bDEuMjc3LS43NDFhMS41OTcgMS41OTcgMCAwMTIuMzk4IDEuMzkydjEuNDgyYzAgLjA0OS4wMDcuMDk1LjAxOS4xNGwuMDA3LjAyOGEuNjE5LjYxOSAwIDAwLjA1MS4xMjVjLjAwNC4wMDYuMDA4LjAxLjAxLjAxNmEuNi42IDAgMDAuMDc2LjFsLjAxNC4wMTVjLjAzMy4wMzIuMDY5LjA2LjEwOC4wODQuMDA0LjAwMi4wMDYuMDA2LjAxMS4wMDhsMi41NTQgMS40ODNhLjU5LjU5IDAgMDAuNTkzIDBsMi41NTQtMS40ODNhLjU5Ny41OTcgMCAwMC4yOTYtLjUxNnYtMi45NjVhLjU5NS41OTUgMCAwMC0uMjk2LS41MTZsLTIuNTU0LTEuNDgzcy0uMDA4LS4wMDItLjAxMi0uMDA1YS41NC41NCAwIDAwLS4xMjYtLjA1MWMtLjAwNy0uMDAzLS4wMTMtLjAwMy0uMDItLjAwNWEuNjM1LjYzNSAwIDAwLS4xMjUtLjAxN2gtLjAxOGEuNTU3LjU1NyAwIDAwLS4xNi4wMjYuNTg4LjU4OCAwIDAwLS4xMy4wNTNsLTEuMjc2Ljc0MmExLjU5NSAxLjU5NSAwIDAxLTEuNTk4IDAgMS42MTUgMS42MTUgMCAwMTAtMi43ODVsLS4wMDUtLjAwMXonLz48cGF0aCBkPSdNMTQuODQ4IDE4LjI2NWwtMi41NTQtMS40ODItLjAxMi0uMDA1YS41MjYuNTI2IDAgMDAtLjEyNi0uMDUyYy0uMDA3LS4wMDItLjAxNC0uMDAyLS4wMi0uMDA1YS42NC42NCAwIDAwLS4xMjQtLjAxN2gtLjAyYS41Ni41NiAwIDAwLS4xNi4wMjYuNTg4LjU4OCAwIDAwLS4xMy4wNTNsLTEuMjc2Ljc0MmExLjU5NCAxLjU5NCAwIDAxLTEuNTk4IDBjLS40OTMtLjI4Ni0uOC0uODItLjgtMS4zOTNWMTQuNjVhLjU2My41NjMgMCAwMC0uMDE4LS4xNGwtLjAwOC0uMDI4YS42MDQuNjA0IDAgMDAtLjA1MS0uMTI0bC0uMDEtLjAxN2EuNjAzLjYwMyAwIDAwLS4wNzYtLjFsLS4wMTQtLjAxNWEuNTk2LjU5NiAwIDAwLS4xMDktLjA4NGMtLjAwMy0uMDAyLS4wMDUtLjAwNi0uMDEtLjAwOEw1LjE3OCAxMi42NWEuNTg3LjU4NyAwIDAwLS41OTEgMGwtMi41NTQgMS40ODNhLjU5Ni41OTYgMCAwMC0uMjk3LjUxNnYyLjk2NWMwIC4yMTMuMTEzLjQxLjI5Ny41MTZsMi41NTQgMS40ODMuMDEyLjAwNGEuNjE4LjYxOCAwIDAwLjI2Ny4wNzRsLjAxNi4wMDJoLjAwN2EuNTUuNTUgMCAwMC4xNi0uMDI2LjU4NC41ODQgMCAwMC4xMjktLjA1M2wxLjI3Ny0uNzQyYTEuNTk3IDEuNTk3IDAgMDEyLjM5OCAxLjM5M3YxLjQ4MmMwIC4wNS4wMDcuMDk1LjAxOS4xNGwuMDA3LjAyOGMuMDEzLjA0NC4wMy4wODUuMDUxLjEyNWwuMDEuMDE2Yy4wMjIuMDM2LjA0Ny4wNy4wNzYuMWwuMDE0LjAxNWMuMDMyLjAzMi4wNjkuMDYuMTA5LjA4NGwuMDEuMDA4IDIuNTU0IDEuNDgzYS41ODcuNTg3IDAgMDAuNTkzIDBsMi41NTQtMS40ODNhLjU5Ni41OTYgMCAwMC4yOTYtLjUxNXYtMi45NjZhLjU5Ni41OTYgMCAwMC0uMjk2LS41MTZoLS4wMDJ6Jy8%2BPC9zdmc%2B" alt="Devin" />
  <img src="https://img.shields.io/badge/OpenAI Compatible-412991?logo=openai&logoColor=white" alt="OpenAI Compatible" />
</p>

</div>

## Features

- **🚀 Ready in minutes** — install, sign in, and start chatting.
- **🔀 Native model picker** — choose your models directly in Copilot Chat.
- **🧠 Reasoning built in** — pick the thinking effort and follow reasoning live.
- **📊 Quota at a glance** — see remaining usage and redeem available Codex resets with confirmation.
- **✨ More than chat** — generate commit messages, titles, and summaries.
- **👥 Account load balancing** — add multiple accounts for the same provider; CLIProxyAPI distributes requests round-robin across available accounts and skips those in cooldown.

<br>

> [!WARNING]
> **Use entirely at your own risk and discretion.** This extension routes chat through your personal AI subscription accounts over OAuth. Accessing subscriptions outside their official apps may violate provider terms and could result in rate limiting or account suspension.

## Demo

<p align="center">
  <img src="https://raw.githubusercontent.com/maxdewald/vscode-universal-chat-provider/main/images/showcase.webp" width="960" alt="Universal Chat Provider showcase: connect subscription accounts, choose chat models and reasoning effort, inspect quota, configure a utility model, and generate a Git commit message" />
</p>

## Quick start

> Requires **VS Code 1.131+** and the **GitHub Copilot Chat** extension.

1. **Install** — get *Universal Chat Provider* from the **[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=maxdewald.universal-chat-provider)**. Prefer to build it yourself? See [Development](#development).
2. **Add an account** — accept the **Add Account** prompt (or run `Universal Chat Provider: Add Account`), pick a provider, and complete OAuth in your browser. Models refresh automatically.
3. **Chat** — open Copilot Chat and select a model under **Universal Chat Provider**.

Manage everything from the status bar item or the *Universal Chat Provider: Manage Provider* command — inspect quota, redeem OpenAI-provided Codex reset credits, list/remove accounts, restart, update, or reset the managed server.

## Commit messages, titles, and summaries

Let your models handle Copilot's light background tasks and Explore searches. Run *Universal Chat Provider: Set Utility Model* (or use the status bar menu), pick a model (and thinking effort), done. A small, fast, inexpensive model is usually the best fit. Clear it to undo.

<details>
<summary>How it works</summary>

The command points Copilot's `chat.utilityModel`, `chat.utilitySmallModel`, and `chat.exploreAgent.defaultModel` settings at your selected model, so commit messages, chat titles, summaries, and Explore searches run through your accounts. It also sets `chat.byokUtilityModelDefault` to `mainAgent`, so remaining utility flows fall back to your selected chat model instead of Copilot's. When the model supports thinking levels, the command also asks for the utility Thinking Effort; commit messages use `chat.utilitySmallModel` plus that effort. No Copilot subscription required.

</details>

## How it works

The extension runs [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) locally and registers its models with VS Code. Your subscriptions then appear directly in the Copilot Chat model picker.

<p align="center">
  <picture>
    <source srcset="images/how-it-works.svg" type="image/svg+xml" />
    <source media="(prefers-color-scheme: dark)" srcset="images/how-it-works-dark.png" />
    <img src="images/how-it-works-light.png" alt="Your subscriptions run through a local CLIProxyAPI proxy over OAuth and appear in VS Code Copilot Chat as models and as the utility model." width="750" />
  </picture>
</p>

## Reference

<details>
<summary>Settings</summary>

<!-- configs -->

| Key                                           | Description                                                                                                                                                                 | Type      | Default                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------- |
| ▿ <b>Connection</b>                           |
| `universalChatProvider.server.mode`           | How CLIProxyAPI is provided.                                                                                                                                                | `string`  | `"managed"`               |
| `universalChatProvider.baseUrl`               | CLIProxyAPI server URL. Used only in external mode.                                                                                                                         | `string`  | `"http://127.0.0.1:8317"` |
| `universalChatProvider.configPath`            | Optional CLIProxyAPI config.yaml path for credential and model metadata discovery.                                                                                          | `string`  | `""`                      |
| `universalChatProvider.autoDetectConfig`      | Search common CLIProxyAPI config locations when no config path is set.                                                                                                      | `boolean` | `true`                    |
| `universalChatProvider.server.managementKey`  | External mode only. Enter your server's existing management key, not its bcrypt hash. Managed mode generates and stores its own key automatically and ignores this setting. | `string`  | `""`                      |
| ▿ <b>Managed Server</b>                       |
| `universalChatProvider.server.updatePolicy`   | How managed CLIProxyAPI updates are handled.                                                                                                                                | `string`  | `"automatic"`             |
| `universalChatProvider.server.version`        | CLIProxyAPI release used when update policy is Manual. Use latest or an exact version.                                                                                      | `string`  | `"latest"`                |
| `universalChatProvider.server.proxyUrl`       | Optional upstream proxy URL for the managed CLIProxyAPI server. Changes prompt before restarting.                                                                           | `string`  | `""`                      |
| ▿ <b>Status Bar</b>                           |
| `universalChatProvider.showQuotaWarnings`     | Warn in the status bar when the model in use is low on quota.                                                                                                               | `boolean` | `true`                    |
| `universalChatProvider.quotaWarningThreshold` | Remaining-quota percent below which the status bar warning appears.                                                                                                         | `number`  | `10`                      |
| ▿ <b>Advanced</b>                             |
| `universalChatProvider.debugLevel`            | Diagnostic detail to collect. Request Logging prompts before restarting the managed server and writes sensitive payloads to disk.                                           | `string`  | `"off"`                   |

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

## Advanced

<details>
<summary>Managed-server updates</summary>

Updates download automatically by default and restart the managed server as soon as no requests are active. Change `universalChatProvider.server.updatePolicy` to `suggestUpdates` or `manual` if you'd rather review or pin them yourself. Manual mode uses the configured version, which defaults to `latest`; enter an exact version to pin it.

</details>

<details>
<summary>Bring your own CLIProxyAPI server</summary>

Prefer to run CLIProxyAPI yourself, such as on a remote or shared machine?

1. Set `universalChatProvider.server.mode` to `external`.
2. Start CLIProxyAPI and complete the provider login there.
3. Use the **Import API Key** notification action when a local config is found, or run *Configure Connection* to enter the URL and key manually.

The API key is stored in VS Code `SecretStorage`. In external mode, the extension never starts or stops the server. To use **Add Account** and **Manage Accounts**, enter your server's existing management key, not its bcrypt hash, in `universalChatProvider.server.managementKey`. Managed mode generates and stores its own key automatically and ignores this setting.

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
