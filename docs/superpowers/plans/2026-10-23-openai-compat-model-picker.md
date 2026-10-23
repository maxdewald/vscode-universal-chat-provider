# OpenAI-compat model multi-select + edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When adding or editing an OpenAI-compatible endpoint, let the user multi-select which upstream `/models` IDs to register (QuickPick), instead of taking all or only removing the whole endpoint.

**Architecture:** Extract a shared `pickUpstreamModelIds` helper next to `discoverUpstreamModels` in `openai-compat-endpoint.ts`. Call it after discovery on add, and from a new Manage Accounts action path on edit. Persistence stays `putOpenAICompatibility` + `persistOpenAICompatibility` (SecretStorage).

**Tech Stack:** VS Code extension TypeScript, vitest, existing `window.showQuickPick` / `ManagementClient` APIs.

## Global Constraints

- No webview.
- No `extraConfig` migration in this patch.
- OAuth / auth-file accounts stay remove-only.
- Add-flow multi-select: **pre-select none** (empty picked → abort).
- Edit-flow multi-select: **pre-select models already on the provider**.
- Alias format stays `${provider.name}/${modelId}`.
- Keep MIT fork under `void-Lu/vscode-universal-chat-provider`, branch `feature/openai-compat-model-picker`.

## File map

| File | Responsibility |
|------|----------------|
| `src/cliproxy/accounts/openai-compat-endpoint.ts` | Discover, pick, build provider; export helpers for edit |
| `src/cliproxy/accounts/accounts.ts` | Manage Accounts: Edit models / Remove for openai-compat |
| `test/cliproxy/accounts/accounts.test.ts` | Update discovery tests for multi-select; add edit tests |
| `CHANGELOG.md` | User-facing note |

---

### Task 1: Shared model picker helper + use on add

**Files:**
- Modify: `src/cliproxy/accounts/openai-compat-endpoint.ts`
- Modify: `test/cliproxy/accounts/accounts.test.ts` (discovery tests that assumed “take all”)
- Test: `pnpm test -- test/cliproxy/accounts/`

**Interfaces:**
- Produces:
  - `export async function discoverUpstreamModels(baseUrl: string, apiKey: string): Promise<string[]>`
  - `export async function pickUpstreamModelIds(options: { modelIds: readonly string[], title: string, preselected?: ReadonlySet<string> }): Promise<string[] | undefined>`
    - Returns `undefined` if user cancels or selects nothing
    - Returns ordered subset preserving `modelIds` order

- [ ] **Step 1: Update failing expectations in accounts tests for discovery path**

In `test/cliproxy/accounts/accounts.test.ts`, every test that stubs `/v1/models` successfully currently does one QuickPick (provider type) then expects all models. Change to:

1. First `showQuickPick` → openai-compatibility account type (unchanged).
2. After InputBoxes for URL/key, **second** `showQuickPick` is the model multi-select — mock it to return the desired subset.

Rename/adjust:

- `exposes every model discovered…` → mock second QuickPick returning both items (`picked` with `canPickMany`); assert `put` still gets both.
- `normalizes…`, `refreshes…`, `does not persist…`, `keeps same-url…` → same pattern: mock model QuickPick to select all discovered IDs (or the single ID).

Helper pattern for mocks (call order):

```ts
window.showQuickPick
  .mockResolvedValueOnce({ label: 'OpenAI-compatible endpoint', account: 'openai-compatibility' })
  .mockImplementationOnce(async (items) => {
    // multi-select: return all items as if user selected all
    return items as Array<{ label: string }>
  })
```

Note: vitest vscode mock may pass `items` as array; when `canPickMany` is true, resolve with an **array** of items. Check `test/support/vscode` if needed — if `showQuickPick` always returns a single value, update the mock helper to return arrays when the call used `canPickMany: true`.

- [ ] **Step 2: Run tests — expect failures**

```bash
cd /workspace/vscode-universal-chat-provider && pnpm test -- test/cliproxy/accounts/accounts.test.ts
```

Expected: discovery tests fail (no second QuickPick / still taking all without pick).

- [ ] **Step 3: Implement helper + wire into `promptOpenAICompatibilityEndpoint`**

In `openai-compat-endpoint.ts`:

1. Export `discoverUpstreamModels` (remove `async function` privacy).
2. Add:

```ts
export async function pickUpstreamModelIds(options: {
  modelIds: readonly string[]
  title: string
  preselected?: ReadonlySet<string>
}): Promise<string[] | undefined> {
  if (options.modelIds.length === 0)
    return undefined
  const selected = await window.showQuickPick(
    options.modelIds.map(id => ({
      label: id,
      picked: options.preselected?.has(id) ?? false,
    })),
    {
      title: options.title,
      placeHolder: 'Select models to register',
      canPickMany: true,
      ignoreFocusOut: true,
    },
  )
  if (selected === undefined || selected.length === 0)
    return undefined
  const chosen = new Set(selected.map(item => item.label))
  return options.modelIds.filter(id => chosen.has(id))
}
```

3. In `promptOpenAICompatibilityEndpoint`, after discovery:

```ts
  let modelIds = discovered
  if (modelIds.length === 0) {
    // existing InputBox fallback unchanged
  }
  else {
    const picked = await pickUpstreamModelIds({
      modelIds,
      title: 'Select models to register',
    })
    if (picked === undefined)
      return undefined
    modelIds = picked
  }
```

- [ ] **Step 4: Run accounts + openai-compat-endpoint tests — expect pass**

```bash
pnpm test -- test/cliproxy/accounts/
```

- [ ] **Step 5: Commit**

```bash
git add src/cliproxy/accounts/openai-compat-endpoint.ts test/cliproxy/accounts/accounts.test.ts
git commit -m "feat: multi-select models when adding openai-compat endpoint"
```

---

### Task 2: Manage Accounts — Edit models / Remove

**Files:**
- Modify: `src/cliproxy/accounts/accounts.ts` (`manageAccounts`)
- Modify: `test/cliproxy/accounts/accounts.test.ts`
- Modify: `CHANGELOG.md` (Unreleased)

**Interfaces:**
- Consumes: `discoverUpstreamModels`, `pickUpstreamModelIds` from openai-compat-endpoint
- Produces: `manageAccounts` behavior change only (no new public class API)

- [ ] **Step 1: Write failing tests**

Update `removes openai-compatibility providers from manage accounts`:

1. Pick endpoint from account list.
2. Second QuickPick: choose `{ label: 'Remove' }` (or `'$(trash) Remove'`).
3. Warning confirm Remove → same assertions.

Add new test `edits models on an openai-compatibility provider`:

```ts
it('edits models on an openai-compatibility provider', async () => {
  vi.spyOn(ManagementClient.prototype, 'listAuthFiles').mockResolvedValue([])
  const existing = {
    'name': 'openrouter.ai',
    'base-url': 'https://openrouter.ai/api/v1',
    'keys': [{ 'api-key': 'sk-or' }],
    'models': [
      { name: 'gpt-5.5', alias: 'openrouter.ai/gpt-5.5' },
      { name: 'claude-opus-4-8', alias: 'openrouter.ai/claude-opus-4-8' },
    ],
  }
  vi.spyOn(ManagementClient.prototype, 'listOpenAICompatibility').mockResolvedValue([existing])
  const put = vi.spyOn(ManagementClient.prototype, 'putOpenAICompatibility').mockResolvedValue()
  window.showQuickPick
    .mockResolvedValueOnce({
      label: 'openrouter.ai',
      description: 'openai-compatibility',
      account: 'openai-compatibility',
    })
    .mockResolvedValueOnce({ label: 'Edit models', action: 'edit-models' })
    .mockImplementationOnce(async (items) => {
      // select only gpt-5.5
      const list = items as Array<{ label: string }>
      return list.filter(item => item.label === 'gpt-5.5')
    })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    data: [{ id: 'gpt-5.5' }, { id: 'claude-opus-4-8' }, { id: 'other' }],
  })))
  const persistOpenAICompatibility = vi.fn<() => Promise<void>>().mockResolvedValue()
  const { service, onAccountsChanged } = serviceWith({ persistOpenAICompatibility })

  await service.manageAccounts()

  expect(put).toHaveBeenCalledWith([
    expect.objectContaining({
      name: 'openrouter.ai',
      models: [{ name: 'gpt-5.5', alias: 'openrouter.ai/gpt-5.5' }],
    }),
  ])
  expect(persistOpenAICompatibility).toHaveBeenCalled()
  expect(onAccountsChanged).toHaveBeenCalledWith(['openrouter.ai/gpt-5.5'])
})
```

Also add: discovery fails → InputBox prefilled with current model names; user edits; put updated list.

- [ ] **Step 2: Run test — expect fail**

```bash
pnpm test -- test/cliproxy/accounts/accounts.test.ts
```

- [ ] **Step 3: Implement manageAccounts edit path**

Replace remove-only flow for openai-compat:

```ts
// after picking an account from the list:
if (picked.account === 'openai-compatibility') {
  const endpoint = endpoints.find(e => e.name === picked.label)
  if (endpoint === undefined)
    return
  const action = await window.showQuickPick(
    [
      { label: '$(edit) Edit models', action: 'edit-models' as const },
      { label: '$(trash) Remove', action: 'remove' as const },
    ],
    { title: endpoint.name, placeHolder: 'Choose an action' },
  )
  if (action === undefined)
    return
  if (action.action === 'remove') {
    // existing confirm + put remaining
    return
  }
  await this.editOpenAIEndpointModels(client, endpoints, endpoint)
  return
}
// oauth: keep existing remove confirm
```

`editOpenAIEndpointModels`:

1. `apiKey = endpoint.keys?.[0]?.['api-key'] ?? ''`
2. `discovered = await withProgress(... discoverUpstreamModels(endpoint['base-url'], apiKey))`
3. If discovered.length > 0: `picked = await pickUpstreamModelIds({ modelIds: discovered, title: \`Models for ${endpoint.name}\`, preselected: new Set((endpoint.models ?? []).map(m => m.name)) })`
4. Else: InputBox value = current names joined by `, `; parse; if empty/cancel abort
5. Rebuild provider: `{ ...endpoint, models: picked.map(name => ({ name, alias: \`${endpoint.name}/${name}\` })) }`
6. `updated = endpoints.map(e => e.name === endpoint.name ? rebuilt : e)`
7. `put` + `persist` + `onAccountsChanged(expected aliases)`

Update placeHolder on first QuickPick: `'Select an account to manage'`.

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm test -- test/cliproxy/accounts/
```

- [ ] **Step 5: CHANGELOG + commit**

Add under Unreleased:

```md
### Added
- Multi-select which models to register when adding an OpenAI-compatible endpoint
- Edit models on an existing OpenAI-compatible endpoint from Manage Accounts
```

```bash
git add src/cliproxy/accounts/accounts.ts test/cliproxy/accounts/accounts.test.ts CHANGELOG.md
git commit -m "feat: edit openai-compat models from Manage Accounts"
```

---

### Task 3: Push fork branch + package VSIX for local install

**Files:** none of product code

- [ ] **Step 1: Push feature branch to fork**

```bash
cd /workspace/vscode-universal-chat-provider
unset HTTPS_PROXY HTTP_PROXY http_proxy https_proxy ALL_PROXY all_proxy
git push -u fork feature/openai-compat-model-picker
```

(Requires Auto-review approval if blocked.)

- [ ] **Step 2: Build VSIX**

```bash
pnpm install
pnpm run package   # or whatever package.json uses (vsce/ovsx) — check scripts
```

Copy `.vsix` to a path the user can install (`Extensions: Install from VSIX…`).

- [ ] **Step 3: Report**

Tell user: fork URL, branch, how to install VSIX, reminder that `extraConfig` openai-compat still overrides SecretStorage on Restart.

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| Add multi-select, preselect none | Task 1 |
| Manual InputBox when discovery fails | Task 1 (unchanged path) |
| Manage Accounts Edit / Remove | Task 2 |
| Prefetch + preselect existing on edit | Task 2 |
| No extraConfig migration | All (out of scope) |
| OAuth unchanged | Task 2 |
| Persist put + SecretStorage | Task 2 |
| CHANGELOG | Task 2 |
| Fork deliverable | Task 3 |
