export const COMMIT_MESSAGE_OUTPUT_TOKENS = 512
export const COMMIT_SUBJECT_OUTPUT_TOKENS = 64

export interface CommitPromptOptions {
  branch?: string
  context: string
  instructions: string
  staged: boolean
}

export function buildCommitMessagePrompt(options: CommitPromptOptions): string {
  const style = options.instructions.length > 0
    ? options.instructions
    : [
        'Write a single Conventional Commits subject line: type(optional-scope): description.',
        'Use an imperative, lowercase description without a trailing period, ideally under 72 characters.',
        'Summarize at a high level — do not enumerate files or chain multiple changes with semicolons.',
        'Output only the subject line. Do not add a body.',
      ].join('\n')

  return [
    'Generate a Git commit message for the changes below.',
    '',
    'Output rules:',
    '- Return only the commit message, with no surrounding blank lines.',
    '- Do not use Markdown fences, quotations, labels, or explanations.',
    '- Do not invent changes that are absent from the supplied context.',
    '',
    'Style instructions:',
    style,
    '',
    `Branch: ${options.branch ?? '(detached HEAD)'}`,
    `Change scope: ${options.staged ? 'staged changes' : 'working tree changes (nothing is staged)'}`,
    '',
    'Changes:',
    options.context,
  ].join('\n')
}

export function normalizeCommitMessage(value: string): string {
  const trimmed = value.trim()
  const fenced = /^```(?:text|gitcommit|markdown)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}
