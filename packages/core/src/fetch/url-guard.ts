export type FetchGuardCode = 'BAD_URL' | 'BAD_SCHEME' | 'PRIVATE_ADDRESS'

export class FetchGuardError extends Error {
  code: FetchGuardCode
  constructor(code: FetchGuardCode, message: string) {
    super(message)
    this.name = 'FetchGuardError'
    this.code = code
  }
}

const PRIVATE_SUFFIXES = ['.internal', '.local', '.localdomain', '.home', '.lan']

/**
 * A conservative deny-list over the ranges that make server-side request
 * forgery useful: loopback, RFC1918, link-local (which includes the cloud
 * metadata address), carrier-grade NAT, and unspecified addresses.
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()

  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true

  // IPv6: loopback, unspecified, unique-local (fc00::/7) and link-local (fe80::/10).
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true
    return false
  }

  const octets = host.split('.')
  if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o))) return false
  const [a, b] = octets.map(Number) as [number, number, number, number]
  if (a === 0 || a === 127) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/**
 * The single gate every outbound URL passes. Private addresses are permitted
 * only when the caller opts in, which the batch command does because the
 * company sites it is tested against may be served from localhost.
 */
export function assertFetchableUrl(raw: string, opts: { allowPrivate?: boolean } = {}): URL {
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new FetchGuardError('BAD_URL', 'empty url')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // A bare hostname is a common paste; assume https rather than rejecting.
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
      try {
        url = new URL(`https://${trimmed}`)
      } catch {
        throw new FetchGuardError('BAD_URL', `cannot parse url: ${raw}`)
      }
    } else {
      throw new FetchGuardError('BAD_URL', `cannot parse url: ${raw}`)
    }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchGuardError('BAD_SCHEME', `scheme not allowed: ${url.protocol}`)
  }

  if (!opts.allowPrivate && isPrivateHostname(url.hostname)) {
    throw new FetchGuardError('PRIVATE_ADDRESS', `refusing to fetch private address: ${url.hostname}`)
  }

  return url
}
