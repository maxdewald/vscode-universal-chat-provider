export function urlHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname
  }
  catch {
    return undefined
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}
