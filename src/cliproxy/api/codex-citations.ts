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

const SearchResultCitationSchema = Type.Object({
  type: Type.Literal('web_search_result_location'),
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
  const sources = new Set<string>()
  for (const value of annotations) {
    // Claude citations carry no text offsets, so their sources are listed after the text.
    const source = asValue(SearchResultCitationSchema, value)
    const sourceLink = source && markdownLink(source.url, source.title)
    if (sourceLink !== undefined)
      sources.add(sourceLink)
    const citation = asValue(CitationSchema, value)
    if (citation === undefined || citation.end_index > characters.length || citation.end_index <= citation.start_index)
      continue
    const marker = characters.slice(citation.start_index, citation.end_index).join('')
    if (!/^\uE200cite\uE202[^\uE201]*\uE201$/.test(marker))
      continue
    const link = markdownLink(citation.url, citation.title)
    if (link === undefined)
      continue
    const replacement = replacements.get(citation.start_index) ?? { end: citation.end_index, links: new Set<string>() }
    replacement.links.add(link)
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
  const body = result + characters.slice(codePointOffset).join('')
  return sources.size > 0 ? `${body}\n\n${[...sources].join(' ')}` : body
}

function markdownLink(rawUrl: string, rawTitle: string): string | undefined {
  const url = URL.parse(rawUrl)
  if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    return undefined
  const title = (rawTitle.trim() || url.hostname)
    .replace(/\s+/g, ' ')
    .replace(/[\\`*_[\]<>]/g, '\\$&')
  return `[${title}](<${url.href}>)`
}
