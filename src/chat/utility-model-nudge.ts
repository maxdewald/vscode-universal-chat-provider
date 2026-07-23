import type { ExtensionContext } from 'vscode'
import type { UniversalChatProvider } from './provider'
import { commands, ConfigurationTarget, extensions, window, workspace } from 'vscode'

const SHOWN_KEY = 'universalChatProvider.utilityModelNudgeShown'
const SET_COMMAND = 'universalChatProvider.setUtilityModel'
const UCP_PREFIX = 'universal-chat-provider/'

export function shouldNudge(opts: {
  alreadyShown: boolean
  utilityModel: string
  copilotInstalled: boolean
}): boolean {
  return !opts.alreadyShown
    && opts.copilotInstalled
    && !opts.utilityModel.trim().startsWith(UCP_PREFIX)
}

export async function maybeSuggestUtilityModel(context: ExtensionContext): Promise<void> {
  const should = shouldNudge({
    alreadyShown: context.globalState.get<boolean>(SHOWN_KEY, false),
    utilityModel: workspace.getConfiguration('chat').get<string>('utilityModel', ''),
    copilotInstalled: extensions.getExtension('GitHub.copilot-chat') !== undefined,
  })
  if (!should)
    return

  await context.globalState.update(SHOWN_KEY, true)

  const choose = 'Choose Model'
  const choice = await window.showInformationMessage(
    'Copilot generates commit messages, chat titles and summaries with its own models. '
    + 'Use one of your Universal Chat Provider models for those instead?',
    choose,
  )
  if (choice === choose)
    await commands.executeCommand(SET_COMMAND)
}

export async function setUtilityModel(provider: UniversalChatProvider): Promise<void> {
  const models = await provider.getModels(true)
  if (models.length === 0) {
    void window.showWarningMessage(
      'No Universal Chat Provider models are available. Configure the provider and refresh its models first.',
    )
    return
  }

  const chat = workspace.getConfiguration('chat')
  const current = chat.get<string>('utilityModel', '').trim()
  const selected = await window.showQuickPick(
    models.map(model => ({
      label: model.name,
      description: UCP_PREFIX + model.id,
      picked: current === UCP_PREFIX + model.id,
      model,
      ...(model.detail !== undefined ? { detail: model.detail } : {}),
    })),
    {
      title: 'Set Utility Model',
      placeHolder: 'Choose a small, fast and inexpensive model for utility tasks and Explore',
      matchOnDescription: true,
    },
  )
  if (selected === undefined)
    return

  const effort = await pickUtilityEffort(selected.model, provider.getUtilityEffort(selected.model.id))
  if (effort === undefined && selected.model.reasoningLevels.length > 0)
    return

  const value = UCP_PREFIX + selected.model.id
  const exploreValue = `${selected.model.name} (universal-chat-provider)`
  await provider.updateUtilityEffort(selected.model.id, effort)
  await chat.update('utilityModel', value, ConfigurationTarget.Global)
  await chat.update('utilitySmallModel', value, ConfigurationTarget.Global)
  await chat.update('exploreAgent.defaultModel', exploreValue, ConfigurationTarget.Global)
  void window.showInformationMessage(
    `Copilot's utility tasks and Explore agent now use ${selected.model.name}${effort !== undefined ? ` (${formatEffort(effort)})` : ''}.`,
  )
}

async function pickUtilityEffort(model: { reasoningLevels: readonly string[] }, current: string | undefined): Promise<string | undefined> {
  if (model.reasoningLevels.length === 0)
    return undefined
  if (model.reasoningLevels.length === 1)
    return model.reasoningLevels[0]

  const fallback = model.reasoningLevels[0]
  const picked = current !== undefined && model.reasoningLevels.includes(current) ? current : fallback
  const selected = await window.showQuickPick(
    model.reasoningLevels.map(effort => ({
      label: formatEffort(effort),
      description: effort,
      picked: effort === picked,
      effort,
    })),
    {
      title: 'Set Utility Thinking Effort',
      placeHolder: 'Effort Copilot uses for commit messages, chat titles and summaries',
    },
  )
  return selected?.effort
}

function formatEffort(value: string): string {
  return value === 'xhigh'
    ? 'Extra High'
    : value.replace(/(?:^|[-_\s])\w/g, match => match.toUpperCase())
}
