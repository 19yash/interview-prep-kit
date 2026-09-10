import { GoogleGenAI } from '@google/genai'
import { TokenBucket } from './limiter.js'
import { GeminiKeyPool } from './key-pool.js'

export type LlmErrorCode = 'RATE_LIMITED' | 'INVALID_JSON' | 'EMPTY' | 'PROVIDER'

export class LlmError extends Error {
  code: LlmErrorCode
  attempts: number
  constructor(code: LlmErrorCode, message: string, attempts: number) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.attempts = attempts
  }
}

export type LlmCall = {
  system: string
  prompt: string
  schema: object
  temperature?: number
  maxOutputTokens?: number
}

export type GroundedResult = { text: string; sources: string[] }

export interface LlmClient {
  generateJson<T>(call: LlmCall, parse: (raw: unknown) => T): Promise<T>
  generateGrounded(call: { system: string; prompt: string }): Promise<GroundedResult>
}

type RawGenerate = (args: {
  system: string
  prompt: string
  schema?: object
  grounded?: boolean
  temperature?: number
  maxOutputTokens?: number
  apiKey?: string
}) => Promise<{ text: string; sources?: string[] }>

export type GeminiOptions = {
  apiKey?: string
  apiKeys?: string[]
  keyPool?: GeminiKeyPool
  model?: string
  maxAttempts?: number
  tokensPerMinute?: number
  sleep?: (ms: number) => Promise<void>
  /** Injected in tests so no network call is made. */
  generate?: RawGenerate
}

const DEFAULT_MODEL = 'gemini-3.5-flash'
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_TPM = 200_000

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown }
  if (typeof candidate.status === 'number') return candidate.status
  if (typeof candidate.code === 'number') return candidate.code
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  const match = message.match(/\b(429|4\d\d|5\d\d)\b/)
  return match ? Number(match[1]) : undefined
}

function isDailyQuotaExhausted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('PerDay') || message.includes('per_day') || message.includes('PerDayPerProject')
}

function isInvalidKeyError(error: unknown): boolean {
  const status = statusOf(error)
  const message = error instanceof Error ? error.message : String(error)
  return (
    (status === 400 || status === 403) &&
    (message.includes('API_KEY_INVALID') ||
      message.includes('API key not valid') ||
      message.includes('PERMISSION_DENIED') ||
      message.includes('has been suspended'))
  )
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

/** Honour an explicit retry delay if the provider sent one, else back off (capped at 15s). */
function backoffMs(error: unknown, attempt: number): number {
  const message = error instanceof Error ? error.message : ''
  const seconds = message.match(/retry(?:-|\s)?(?:delay|after)["':\s]+(\d+)/i)
  if (seconds?.[1]) return Math.min(Number(seconds[1]) * 1000, 15_000)
  const base = 1000 * 2 ** (attempt - 1)
  return Math.min(base + Math.floor(Math.random() * 400), 15_000)
}

/** Models sometimes fence JSON despite being told not to. Cheap to tolerate. */
function stripFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

export function createGeminiClient(opts: GeminiOptions = {}): LlmClient {
  const model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const sleep = opts.sleep ?? defaultSleep
  const bucket = new TokenBucket({
    capacity: opts.tokensPerMinute ?? DEFAULT_TPM,
    refillPerMs: (opts.tokensPerMinute ?? DEFAULT_TPM) / 60_000,
  })

  const keyPool =
    opts.keyPool ??
    (opts.apiKeys && opts.apiKeys.length > 0
      ? new GeminiKeyPool(opts.apiKeys)
      : opts.apiKey
        ? new GeminiKeyPool([opts.apiKey])
        : GeminiKeyPool.fromEnv())

  const generate: RawGenerate =
    opts.generate ??
    (async ({ system, prompt, schema, grounded, temperature, maxOutputTokens, apiKey: callApiKey }) => {
      const apiKey = callApiKey ?? (keyPool.hasAvailableKey() ? keyPool.getActiveKey() : undefined)
      if (!apiKey) throw new LlmError('PROVIDER', 'GEMINI_API_KEY is not set', 0)
      const ai = new GoogleGenAI({ apiKey })

      // Grounding and a response schema cannot be combined, so a grounded call
      // returns prose and a later structuring call turns it into JSON.
      const config: Record<string, unknown> = {
        systemInstruction: system,
        temperature: temperature ?? 0.3,
        maxOutputTokens: maxOutputTokens ?? 4096,
      }
      if (grounded) {
        config.tools = [{ googleSearch: {} }]
      } else if (schema) {
        config.responseMimeType = 'application/json'
        config.responseSchema = schema
      }

      const response = await ai.models.generateContent({ model, contents: prompt, config })
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
      const sources = chunks
        .map((chunk) => chunk.web?.uri)
        .filter((uri): uri is string => typeof uri === 'string')
      return { text: response.text ?? '', sources }
    })

  /** Shared retry envelope: rate limits back off, daily quota and invalid keys fail over to next key. */
  async function attempt<T>(
    run: (attemptNumber: number, note: string, apiKey: string) => Promise<T>,
  ): Promise<T> {
    if (keyPool.size === 0 && !opts.generate) {
      throw new LlmError('PROVIDER', 'GEMINI_API_KEY is not set', 0)
    }

    const triedKeys = new Set<string>()
    let lastError: unknown

    // If keyPool has keys, use them; if keyPool is empty (e.g. injected stub with no keys), use fallback placeholder
    const availableKeysExist = keyPool.hasAvailableKey() || Boolean(opts.generate)

    while (availableKeysExist && (keyPool.hasAvailableKey() || triedKeys.size === 0)) {
      let currentKey = 'test-stub-key'
      if (keyPool.size > 0) {
        try {
          currentKey = keyPool.getActiveKey()
        } catch (err) {
          throw new LlmError('RATE_LIMITED', (err as Error).message, 1)
        }
      }

      if (triedKeys.has(currentKey)) {
        break
      }
      triedKeys.add(currentKey)

      let note = ''
      let keySwitched = false

      for (let n = 1; n <= maxAttempts; n += 1) {
        await bucket.take(2000)
        try {
          const result = await run(n, note, currentKey)
          if (keyPool.size > 0) keyPool.markSuccess(currentKey)
          return result
        } catch (error) {
          lastError = error
          if (error instanceof LlmError && error.code === 'INVALID_JSON') {
            note = `Your previous response could not be parsed: ${error.message}. Return only valid JSON matching the schema.`
            continue
          }

          if (isDailyQuotaExhausted(error)) {
            const next = keyPool.size > 0 ? keyPool.markDailyQuotaExhausted(currentKey, undefined, String(error)) : null
            if (next && !triedKeys.has(next)) {
              keySwitched = true
              break
            }
            throw new LlmError('RATE_LIMITED', `daily quota exhausted on all available keys: ${String(error)}`, n)
          }

          if (isInvalidKeyError(error)) {
            const next = keyPool.size > 0 ? keyPool.markInvalid(currentKey, String(error)) : null
            if (next && !triedKeys.has(next)) {
              keySwitched = true
              break
            }
            throw new LlmError('PROVIDER', `provider error (invalid key): ${String(error)}`, n)
          }

          const status = statusOf(error)
          if (!isRetryableStatus(status)) {
            if (error instanceof LlmError) throw error
            throw new LlmError('PROVIDER', `provider error: ${String(error)}`, n)
          }

          if (n === maxAttempts) {
            if (keyPool.size > 1) {
              const next = keyPool.rotate()
              if (next && !triedKeys.has(next)) {
                keySwitched = true
                break
              }
            }
            break
          }

          await sleep(backoffMs(error, n))
        }
      }

      if (!keySwitched) {
        break
      }
    }

    if (lastError instanceof LlmError) throw lastError
    throw new LlmError('RATE_LIMITED', `gave up after ${maxAttempts} attempts across available keys: ${String(lastError)}`, maxAttempts)
  }

  return {
    async generateJson<T>(call: LlmCall, parse: (raw: unknown) => T): Promise<T> {
      return attempt(async (n, note, activeKey) => {
        const { text } = await generate({
          system: call.system,
          prompt: note ? `${call.prompt}\n\n${note}` : call.prompt,
          schema: call.schema,
          temperature: call.temperature,
          maxOutputTokens: call.maxOutputTokens,
          apiKey: activeKey,
        })
        if (text.trim().length === 0) throw new LlmError('EMPTY', 'model returned an empty response', n)
        let parsedJson: unknown
        try {
          parsedJson = JSON.parse(stripFence(text))
        } catch (error) {
          throw new LlmError('INVALID_JSON', error instanceof Error ? error.message : String(error), n)
        }
        try {
          return parse(parsedJson)
        } catch (error) {
          throw new LlmError('INVALID_JSON', error instanceof Error ? error.message : String(error), n)
        }
      })
    },

    async generateGrounded(call: { system: string; prompt: string }): Promise<GroundedResult> {
      return attempt(async (_n, _note, activeKey) => {
        const { text, sources } = await generate({
          system: call.system,
          prompt: call.prompt,
          grounded: true,
          apiKey: activeKey,
        })
        return { text: text.trim(), sources: [...new Set(sources ?? [])] }
      })
    },
  }
}

export type StubResponses = {
  json?: unknown[] | ((call: LlmCall) => unknown)
  grounded?: GroundedResult
  failJsonTimes?: number
}

/** The double every step test uses, so step tests never touch the network. */
export function createStubClient(responses: StubResponses = {}): LlmClient {
  const queue = Array.isArray(responses.json) ? [...responses.json] : null
  let failuresLeft = responses.failJsonTimes ?? 0

  return {
    async generateJson<T>(call: LlmCall, parse: (raw: unknown) => T): Promise<T> {
      if (failuresLeft > 0) {
        failuresLeft -= 1
        throw new LlmError('PROVIDER', 'stubbed failure', 1)
      }
      const raw = typeof responses.json === 'function' ? responses.json(call) : queue?.shift()
      if (raw === undefined) throw new LlmError('EMPTY', 'stub has no queued response', 1)
      return parse(raw)
    },
    async generateGrounded() {
      return responses.grounded ?? { text: '', sources: [] }
    },
  }
}
