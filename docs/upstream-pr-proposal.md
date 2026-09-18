# Upstream Contribution Proposal

## Repository Routing

- **Canonical upstream:** `https://github.com/maxdewald/vscode-universal-chat-provider`
- **Upstream remote:** `upstream`
- **Personal repository:** `origin`
- **Personal fork-style remote:** `fork`
- **PR base:** `maxdewald/vscode-universal-chat-provider:main`
- **Local contribution branch:** `contribute/upstream-authorized-claude-models`
- **Branch base:** `upstream/main` at `94378ed` (`v0.47.1`)

The contribution branch is intentionally based on the current upstream branch rather than the downstream `main`. The downstream branch contains branding, release, deployment, Squad, and product changes that should not be sent upstream as one combined PR.

## Proposed Upstream Changes

These are the changes worth evaluating for contribution. They should be ported as small commits onto this branch, with tests and current-upstream adaptations included.

### 1. Authorized Claude model discovery

- **Source changes:** `src/cliproxy/accounts/claude-models.ts`, model registry integration, management/proxy client access, shared fetch configuration.
- **Tests:** Claude account discovery, model registry behavior, and client request coverage.
- **Why upstream:** This is provider functionality that can benefit the upstream project directly, provided the implementation still matches the current `0.47.1` account and model APIs.
- **Status:** Candidate. The old downstream commit was written against an older code layout and must be rebased/adapted rather than cherry-picked blindly.

### 2. Duplex-aware fetch configuration for Claude discovery

- **Source changes:** shared fetch configuration and the callers that need a duplex-capable request body.
- **Tests:** exercise the real request path used by Claude discovery/client calls.
- **Why upstream:** This is a narrowly scoped runtime compatibility fix if the upstream implementation still needs it.
- **Status:** Candidate, but it should be reviewed together with authorized Claude discovery because the original downstream commit combined both concerns.

### 3. Reasoning and tool compatibility behavior

- **Source changes:** model/provider/request-builder behavior that omits incompatible reasoning options when function tools are present, while preserving reasoning for plain chat.
- **Tests:** tool-bearing and tool-free request paths against the current upstream request model.
- **Why upstream:** The behavior addresses a provider/model compatibility constraint rather than downstream deployment policy.
- **Status:** Separate candidate PR or follow-up. The downstream implementation was coupled to model metadata and the older `gpt-5.6` integration, so it needs a fresh comparison against current upstream before implementation.

### 4. Azure AI Foundry support

- **Source changes:** Azure Foundry endpoint/account management, deployment synchronization, and related tests.
- **Why upstream:** Potentially useful provider support for the upstream project.
- **Status:** Separate feature proposal, not part of the first compatibility PR. It is a large cross-cutting feature and should be discussed with upstream before implementation.

## Proposed PR Shape

### Recommended first PR

**Title:** `fix: support authorized Claude model discovery`

**Scope:**

1. Port authorized Claude model discovery to the current upstream architecture.
2. Include only the shared fetch change required by that discovery path.
3. Add or update integration-level tests for the real management/client boundaries.
4. Do not include package identity, release-channel, deployment, Squad, Azure Foundry, or CLIProxyAPI fork changes.

### Follow-up PRs

- Reasoning/tool compatibility, after confirming the behavior is still needed by current upstream models.
- Azure AI Foundry support, after upstream maintainer feedback on endpoint/account design.

## Validation Gates Before Creating the GitHub PR

- Confirm every changed file is part of the selected upstream feature.
- Run the repository's focused integration tests for model discovery and request construction.
- Run the repository's lint, typecheck, and build commands.
- Review `git diff upstream/main...HEAD` and confirm no downstream-only files are present.
- Push the contribution branch to `origin` under a clearly named branch only after the patch is ready for review.
- Create the GitHub PR with base `maxdewald/vscode-universal-chat-provider:main` and head `jerstadgeirivar-gmail:<branch>`.

## Open Questions For Upstream

- Is authorized Claude model discovery still desired now that upstream is at `0.47.1`?
- Does upstream prefer the fetch/duplex change as part of that feature or as a separate bug fix?
- Should Azure AI Foundry support be discussed as a design issue before code is submitted?
- Which provider/model compatibility cases should be covered by upstream's current integration test conventions?
