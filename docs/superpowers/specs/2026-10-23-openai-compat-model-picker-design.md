# Design: OpenAI-compat model multi-select + edit

Date: 2026-10-23  
Fork: https://github.com/void-Lu/vscode-universal-chat-provider  
Upstream: maxdewald/vscode-universal-chat-provider (v1.4.1)

## Goal

Let users choose which upstream models to register when adding an OpenAI-compatible endpoint, and edit that list later from Manage Accounts — without a webview.

## Non-goals

- Webview admin panel
- Automatic migration of `server.extraConfig` openai-compatibility entries
- Editing OAuth / credential-file account model lists
- Changing CLIProxyAPI itself

## Current behavior

1. `promptOpenAICompatibilityEndpoint` fetches `/v1/models` via `discoverUpstreamModels`.
2. On success it keeps **every** ID; on failure it asks for a comma-separated InputBox.
3. `manageAccounts` can only **remove** an openai-compat endpoint.

## Proposed behavior

### A. Add flow (`openai-compat-endpoint.ts`)

After successful discovery:

- Show `window.showQuickPick` with `canPickMany: true`, one item per model ID.
- Pre-select: none (user must opt in), or optionally first N — **decision: pre-select none** so large catalogs (e.g. Nvidia ~84) do not flood the registry by default.
- Cancel / empty selection → abort add (same as cancelling InputBox).
- Failure path: keep existing comma-separated InputBox.

Then existing `buildOpenAICompatibilityProvider` / `alias: name/provider` logic unchanged.

### B. Edit flow (`accounts.ts` manageAccounts)

For each openai-compat list item, instead of remove-on-accept:

1. QuickPick action: **Edit models** | **Remove**.
2. Edit models:
   - Re-fetch with `discoverUpstreamModels(baseUrl, apiKey)` (export the helper or share via module).
   - Multi-select QuickPick; **pre-check models already in the provider**.
   - If discovery fails, fall back to InputBox prefilled with current model names.
   - Rebuild `models: [{ name, alias: `${provider.name}/${name}` }]`, preserving other provider fields (keys, base-url, name).
   - Persist via existing `putOpenAICompatibility` + SecretStorage path used by add.

OAuth / file accounts: unchanged (remove-only).

### C. Persistence note (documented, not fixed in this patch)

Managed mode rebuilds `config.yaml` from SecretStorage then merges `extraConfig`. If `extraConfig` still contains `api-keys.openai-compatibility`, it **replaces** the SecretStorage list on restart. Users who edit YAML should keep openai-compat only in SecretStorage (UI) or only in extraConfig — not both. This patch does not migrate; README/changelog may mention the conflict.

## Files to touch

| File | Change |
|------|--------|
| `src/cliproxy/accounts/openai-compat-endpoint.ts` | Multi-select after discovery; export `discoverUpstreamModels` (or a shared select helper) |
| `src/cliproxy/accounts/accounts.ts` | Manage Accounts submenu: Edit models / Remove |
| Tests under `src/cliproxy/accounts/` | Selection + edit behavior |
| `CHANGELOG.md` | Note the UX |

## Testing

- Unit/integration tests with mocked `window.showQuickPick` / discovery.
- Manual: Add Nvidia endpoint → pick 3 models → Manage Accounts → Edit → deselect one → Refresh Models.

## Risks

- Large model lists: QuickPick is acceptable; no search filter beyond VS Code’s built-in filter.
- Live PUT succeeds but Restart + conflicting extraConfig undoes edits — document only.
