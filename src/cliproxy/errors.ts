/** An HTTP-level failure from a CLIProxyAPI request, carrying the status code. */
export class ProxyHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
  }
}
