import type { TextRenderer } from '@src/cliproxy/api/responses-stream'
import { Type } from '@sinclair/typebox'
import { asValue } from '@src/shared/json'

const CitationSchema = Type.Object({
  type: Type.Literal('url_citation'),
  start_index: Type.Integer({ minimum: 0 }),
  end_index: Type.Integer({ minimum: 0 }),
  url: Type.String(),
  title: Type.String(),
})

// ChatGPT-backend models wrap citations in private-use glyphs: U+E200 cite U+E202 id U+E201.
export const codexCitations: TextRenderer = {
  marker: '\uE200',
  render: renderCitations,
}

function renderCitations(text: string, emittedUtf16Length: number, annotations: unknown[]): string {
  const characters = Array.from(text)
  const replacements = new Map<number, { end: number, links: Set<string> }>()
  for (const value of annotations) {
    const citation = asValue(CitationSchema, value)
    if (citation === undefined || citation.end_index > characters.length || citation.end_index <= citation.start_index)
      continue
    const marker = characters.slice(citation.start_index, citation.end_index).join('')
    if (!/^\uE200cite\uE202[^\uE201]*\uE201$/.test(marker))
      continue
    const url = URL.parse(citation.url)
    if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:'))
      continue
    const title = (citation.title.trim() || url.hostname)
      .replace(/\s+/g, ' ')
      .replace(/[\\`*_[\]<>]/g, '\\$&')
    const replacement = replacements.get(citation.start_index) ?? { end: citation.end_index, links: new Set<string>() }
    replacement.links.add(`[${title}](<${url.href}>)`)
    replacements.set(citation.start_index, replacement)
  }
  let codePointOffset = Array.from(text.slice(0, emittedUtf16Length)).length
  let result = ''
  const orderedReplacements = [...replacements].sort(([left], [right]) => left - right)
  for (const [start, replacement] of orderedReplacements) {
    if (start < codePointOffset)
      continue
    result += characters.slice(codePointOffset, start).join('') + [...replacement.links].join(' ')
    codePointOffset = replacement.end
  }
  return result + characters.slice(codePointOffset).join('')
}
