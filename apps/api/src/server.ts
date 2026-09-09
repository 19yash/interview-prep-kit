import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import mongoose from 'mongoose'
import { connectDb } from './db.js'
import { env, isProduction, parseOrigins } from './env.js'
import { errorHandler, notFound } from './middleware/errors.js'
import { authRouter } from './routes/auth.js'
import { itemsRouter } from './routes/items.js'
import { kitsRouter } from './routes/kits.js'
import { practiceRouter } from './routes/practice.js'
import { regenerateRouter } from './routes/regenerate.js'

export function createServer(): express.Express {
  const app = express()

  // Render terminates TLS at its edge. Without this Express sees a plain HTTP
  // connection and silently refuses to set a `secure` cookie, which looks
  // exactly like "login works but the session never sticks".
  app.set('trust proxy', 1)

  const allowed = parseOrigins(env.WEB_ORIGIN)
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        // No Origin header means a same-origin or non-browser caller, such as
        // the batch command or a health probe.
        if (!origin) return callback(null, true)
        callback(null, allowed.includes(origin.replace(/\/+$/, '')))
      },
    }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => {
    // 1 is "connected" in mongoose's readyState. A health check that returns
    // 200 while the database is unreachable is worse than none.
    const states: Record<number, string> = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
      99: 'uninitialized',
    }
    res.json({ ok: true, database: states[mongoose.connection.readyState] ?? 'unknown' })
  })

  // The only unauthenticated writes in the application.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'too many attempts — wait a few minutes and try again' } },
  })
  app.use('/api/auth/login', authLimiter)
  app.use('/api/auth/register', authLimiter)

  app.use('/api/auth', authRouter)
  app.use('/api/kits', kitsRouter)
  app.use('/api/kits', itemsRouter)
  app.use('/api/kits', regenerateRouter)
  app.use('/api/kits', practiceRouter)

  app.use(notFound)
  app.use(errorHandler)
  return app
}

if (process.argv[1]?.includes('server')) {
  const app = createServer()
  connectDb(env.MONGODB_URI)
    .then(() => {
      app.listen(env.PORT, () => {
        console.log(`api listening on ${env.PORT} (${isProduction ? 'production' : env.NODE_ENV})`)
        console.log(`allowed origins: ${parseOrigins(env.WEB_ORIGIN).join(', ') || '(none configured)'}`)
      })
    })
    .catch((error) => {
      console.error('failed to start:', error)
      process.exit(1)
    })
}
