import { request } from 'undici'
import { assertFetchableUrl } from './url-guard.js'

export const DEFAULT_TIMEOUT_MS = 8000
export const DEFAULT_MAX_BYTES = 1_500_000
export const MAX_REDIRECTS = 3
export const USER_AGENT = 'InterviewPrepKitBot/1.0 (+assessment project)'
export const ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain']

export type FetchErrorCode = 'TIMEOUT' | 'HTTP_ERROR' | 'BAD_CONTENT_TYPE' | 'TOO_LARGE' | 'NETWORK'

export class FetchError extends Error {
  code: FetchErrorCode
  status?: number
  constructor(code: FetchErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'FetchError'
    this.code = code
    this.status = status
  }
}

export type FetchOptions = {
  timeoutMs?: number
  maxBytes?: number
  allowPrivate?: boolean
  userAgent?: string
}

export type FetchedPage = {
  url: string
  finalUrl: string
  status: number
  contentType: string
  html: string
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

/**
 * Throw away a body we are not going to read. undici surfaces the resulting
 * abort as an unhandled error unless it is listened for, so attach a sink
 * before destroying.
 */
function discard(body: { on: (event: string, listener: () => void) => unknown; destroy: () => void }): void {
  body.on('error', () => {})
  body.destroy()
}

/**
 * One capped, guarded HTTP GET. Every retrieval in the pipeline goes through
 * here so the content-type, size, redirect and timeout limits cannot be
 * bypassed by an individual step.
 *
 * Redirects are followed by hand rather than by undici, because undici 7
 * removed `maxRedirections` from `request`. Following them here is also the
 * safer option: every hop is re-checked by the URL guard, so a public page
 * cannot redirect us onto a private address.
 */
export async function fetchPage(raw: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const requested = assertFetchableUrl(raw, { allowPrivate: opts.allowPrivate })
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  let current = requested
  for (let hop = 0; ; hop += 1) {
    let response
    try {
      response = await request(current.href, {
        method: 'GET',
        // undici's own timeouts are per-phase and, at small values, unreliable.
        // One signal over the whole request is the timeout we actually promise.
        signal: AbortSignal.timeout(timeoutMs),
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        headers: {
          'user-agent': opts.userAgent ?? USER_AGENT,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/timeout|aborted/i.test(message)) throw new FetchError('TIMEOUT', `timed out fetching ${current.href}`)
      throw new FetchError('NETWORK', `network failure fetching ${current.href}: ${message}`)
    }

    if (response.statusCode >= 300 && response.statusCode < 400) {
      const location = headerValue(response.headers['location'])
      discard(response.body)
      if (location.length === 0) {
        throw new FetchError('HTTP_ERROR', `${current.href} returned ${response.statusCode} without a location`, response.statusCode)
      }
      if (hop >= MAX_REDIRECTS) {
        throw new FetchError('NETWORK', `too many redirects fetching ${requested.href}`)
      }
      let next: string
      try {
        next = new URL(location, current.href).href
      } catch {
        throw new FetchError('NETWORK', `unparseable redirect target "${location}" from ${current.href}`)
      }
      // Re-guard: a redirect must not carry us somewhere we refused to go.
      current = assertFetchableUrl(next, { allowPrivate: opts.allowPrivate })
      continue
    }

    if (response.statusCode >= 400) {
      discard(response.body)
      throw new FetchError('HTTP_ERROR', `${current.href} returned ${response.statusCode}`, response.statusCode)
    }

    const contentType = headerValue(response.headers['content-type'])
    if (!ALLOWED_CONTENT_TYPES.some((allowed) => contentType.toLowerCase().includes(allowed))) {
      discard(response.body)
      throw new FetchError('BAD_CONTENT_TYPE', `${current.href} returned unsupported content type "${contentType}"`)
    }

    const chunks: Buffer[] = []
    let total = 0
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += buffer.byteLength
        if (total > maxBytes) {
          discard(response.body)
          throw new FetchError('TOO_LARGE', `${current.href} exceeded ${maxBytes} bytes`)
        }
        chunks.push(buffer)
      }
    } catch (error) {
      if (error instanceof FetchError) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (/timeout|aborted/i.test(message)) throw new FetchError('TIMEOUT', `timed out reading ${current.href}`)
      throw new FetchError('NETWORK', `failed reading ${current.href}: ${message}`)
    }

    return {
      url: requested.href,
      finalUrl: current.href,
      status: response.statusCode,
      contentType,
      html: Buffer.concat(chunks).toString('utf8'),
    }
  }
}
