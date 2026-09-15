export const SUPPLIER_HEADERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'opencode.ai': {
    'x-opencode-session': '$CPA-SESSION-ID',
  },
  'openrouter.ai': {
    'x-session-id': '$CPA-SESSION-ID',
  },
}
