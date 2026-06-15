import type { CancellationToken, QuickPickItem, Uri } from 'vscode'
import type { ProviderModel } from '../chat/model'
import { ConfigurationTarget, window, workspace } from 'vscode'
import { errorMessage } from '../shared/errors'
import { collectChangeContext, resolveRepository, uniqueChanges } from './git'
import {
  buildCommitMessagePrompt,
  COMMIT_MESSAGE_OUTPUT_TOKENS,
  COMMIT_SUBJECT_OUTPUT_TOKENS,
  normalizeCommitMessage,
} from './prompt'

/** The slice of the chat provider the commit feature needs. */
export interface CommitMessageProvider {
  getModels: (interactive: boolean, token?: CancellationToken) => Promise<readonly ProviderModel[]>
  completeText: (
    model: ProviderModel,
    prompt: string,
    maxOutputTokens: number,
    token?: CancellationToken,
  ) => Promise<string | undefined>
}

interface ModelQuickPickItem extends QuickPickItem {
  readonly model: ProviderModel
}

/** Generates commit messages from repository changes via the chat provider. */
export class CommitMessageService {
  constructor(private readonly provider: CommitMessageProvider) {}

  async selectModel(): Promise<ProviderModel | undefined> {
    return this.resolveModel(true)
  }

  async generate(
    rootUri?: Uri,
    _resourceContext?: readonly unknown[],
    token?: CancellationToken,
  ): Promise<void> {
    if (token?.isCancellationRequested)
      return

    try {
      const repository = await resolveRepository(rootUri)
      if (repository === undefined)
        return

      await repository.status()
      if (token?.isCancellationRequested)
        return

      if (repository.state.mergeChanges.length > 0) {
        void window.showWarningMessage(
          'Resolve the repository merge conflicts before generating a commit message.',
        )
        return
      }

      const staged = repository.state.indexChanges.length > 0
      const changes = staged
        ? repository.state.indexChanges
        : uniqueChanges([
            ...repository.state.workingTreeChanges,
            ...repository.state.untrackedChanges,
          ])
      if (changes.length === 0) {
        void window.showInformationMessage('There are no changes to describe in a commit message.')
        return
      }

      const model = await this.resolveModel(false, token)
      if (model === undefined || token?.isCancellationRequested)
        return

      const context = await collectChangeContext(repository, changes, staged, token)
      if (token?.isCancellationRequested)
        return

      const instructions = workspace
        .getConfiguration('universalChatProvider', repository.rootUri)
        .get<string>('commitMessage.instructions', '')
        .trim()
      const branch = repository.state.HEAD?.name
      const prompt = buildCommitMessagePrompt({
        context,
        instructions,
        staged,
        ...(branch !== undefined ? { branch } : {}),
      })
      const maxOutputTokens = instructions.length > 0
        ? COMMIT_MESSAGE_OUTPUT_TOKENS
        : COMMIT_SUBJECT_OUTPUT_TOKENS
      const response = await this.provider.completeText(
        model,
        prompt,
        maxOutputTokens,
        token,
      )
      if (response === undefined || token?.isCancellationRequested)
        return

      const message = normalizeCommitMessage(response)
      if (message.length === 0) {
        void window.showWarningMessage('CLIProxyAPI returned an empty commit message.')
        return
      }
      repository.inputBox.value = message
    }
    catch (error) {
      if (!token?.isCancellationRequested) {
        void window.showErrorMessage(
          `Could not generate a commit message: ${errorMessage(error)}`,
        )
      }
    }
  }

  private async resolveModel(
    forcePicker: boolean,
    token?: CancellationToken,
  ): Promise<ProviderModel | undefined> {
    const models = await this.provider.getModels(true, token)
    if (token?.isCancellationRequested)
      return undefined
    if (models.length === 0) {
      void window.showWarningMessage(
        'No CLIProxyAPI models are available. Configure the provider and refresh its models first.',
      )
      return undefined
    }

    const settings = workspace.getConfiguration('universalChatProvider')
    const configuredId = settings.get<string>('commitMessage.model', '').trim()
    const configuredModel = models.find(model => model.id === configuredId)
    if (!forcePicker && configuredModel !== undefined)
      return configuredModel

    if (!forcePicker && models.length === 1) {
      const model = models[0]!
      await settings.update('commitMessage.model', model.id, ConfigurationTarget.Global)
      return model
    }

    const items: ModelQuickPickItem[] = models.map(model => ({
      label: model.name,
      description: model.id,
      picked: model.id === configuredId,
      model,
      ...(model.detail !== undefined ? { detail: model.detail } : {}),
    }))
    const selected = await window.showQuickPick(items, {
      title: 'Select Commit Message Model',
      placeHolder: 'Choose the CLIProxyAPI model used only for commit messages',
      matchOnDescription: true,
      matchOnDetail: true,
    })
    if (selected === undefined)
      return undefined

    await settings.update('commitMessage.model', selected.model.id, ConfigurationTarget.Global)
    return selected.model
  }
}
