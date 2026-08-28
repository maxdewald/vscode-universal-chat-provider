/**
 * Keeps `duplex` when VS Code's proxy-aware fetch adds a dispatcher.
 *
 * In Node.js 24 / Undici 7, reconstructing a Request with a stream body and no
 * `duplex` in the init object throws before the request is sent.
 */
export const vscodeCompatibleFetch: typeof fetch = async (input, init) => {
  if (input instanceof Request && input.body && init?.duplex === undefined)
    init = { ...init, duplex: 'half' }
  return fetch(input, init)
}
