import { GoogleGenAI } from '@google/genai'
import { TokenBucket } from './limiter.js'

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
}) => Promise<{ text: string; sources?: string[] }>

export type GeminiOptions = {
  apiKey?: string
  model?: string
  maxAttempts?: number
  tokensPerMinute?: number
  sleep?: (ms: number) => Promise<void>
  /** Injected in tests so no network call is made. */
  generate?: RawGenerate
}

const DEFAULT_MODEL = 'gemini-2.5-flash'
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

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

/** Honour an explicit retry delay if the provider sent one, else back off. */
function backoffMs(error: unknown, attempt: number): number {
  const message = error instanceof Error ? error.message : ''
  const seconds = message.match(/retry(?:-|\s)?(?:delay|after)["':\s]+(\d+)/i)
  if (seconds?.[1]) return Number(seconds[1]) * 1000
  const base = 1000 * 2 ** (attempt - 1)
  return base + Math.floor(Math.random() * 400)
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

  const generate: RawGenerate =
    opts.generate ??
    (async ({ system, prompt, schema, grounded, temperature, maxOutputTokens }) => {
      const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY
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

  /** Shared retry envelope: rate limits back off, provider errors do not. */
  async function attempt<T>(
    run: (attemptNumber: number, note: string) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown
    let note = ''
    for (let n = 1; n <= maxAttempts; n += 1) {
      await bucket.take(2000)
      try {
        return await run(n, note)
      } catch (error) {
        lastError = error
        if (error instanceof LlmError && error.code === 'INVALID_JSON') {
          note = `Your previous response could not be parsed: ${error.message}. Return only valid JSON matching the schema.`
          continue
        }
        const status = statusOf(error)
        if (!isRetryableStatus(status)) {
          if (error instanceof LlmError) throw error
          throw new LlmError('PROVIDER', `provider error: ${String(error)}`, n)
        }
        if (n === maxAttempts) break
        await sleep(backoffMs(error, n))
      }
    }
    if (lastError instanceof LlmError) throw lastError
    throw new LlmError('RATE_LIMITED', `gave up after ${maxAttempts} attempts: ${String(lastError)}`, maxAttempts)
  }

  return {
    async generateJson<T>(call: LlmCall, parse: (raw: unknown) => T): Promise<T> {
      return attempt(async (n, note) => {
        const { text } = await generate({
          system: call.system,
          prompt: note ? `${call.prompt}\n\n${note}` : call.prompt,
          schema: call.schema,
          temperature: call.temperature,
          maxOutputTokens: call.maxOutputTokens,
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
      return attempt(async () => {
        const { text, sources } = await generate({ system: call.system, prompt: call.prompt, grounded: true })
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
