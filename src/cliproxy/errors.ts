export class ProxyHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function isProxyCredentialRejection(error: unknown): error is ProxyHttpError {
  return error instanceof ProxyHttpError && error.status === 401
}
