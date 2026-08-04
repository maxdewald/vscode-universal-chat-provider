import type { Input } from 'ky'

// ky attaches the request body to the Request object but forwards a second `init` argument to
// fetch that omits `duplex` — it treats `duplex` as a standard request option and strips it from
// the init (so passing `duplex: 'half'` in a per-call ky option never reaches fetch). Older undici
// builds — including the one bundled in the VS Code extension host — then re-wrap
// `fetch(requestWithBody, init)`, see a body, and throw "RequestInit: duplex option is required
// when sending a body." Injecting `duplex` into the init here guarantees it reaches fetch. It is
// ignored for bodyless requests (GET/DELETE), so it is safe to apply unconditionally.
export async function duplexFetch(input: Input, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, { ...init, duplex: 'half' })
}
