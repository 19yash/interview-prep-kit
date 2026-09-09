import type { ErrorRequestHandler, RequestHandler } from 'express'

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'no such endpoint' } })
}

/** One shape for every error the interface has to render. */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } })
    return
  }
  console.error(error)
  res.status(500).json({ error: { code: 'INTERNAL', message: 'something went wrong' } })
}
