import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { connectDb } from './db.js'
import { env } from './env.js'
import { errorHandler, notFound } from './middleware/errors.js'
import { authRouter } from './routes/auth.js'
import { itemsRouter } from './routes/items.js'
import { kitsRouter } from './routes/kits.js'
import { practiceRouter } from './routes/practice.js'
import { regenerateRouter } from './routes/regenerate.js'

export function createServer(): express.Express {
  const app = express()

  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter)
  app.use('/api/kits', kitsRouter)
  app.use('/api/kits', itemsRouter)
  app.use('/api/kits', regenerateRouter)
  app.use('/api/kits', practiceRouter)

  app.use(notFound)
  app.use(errorHandler)
  return app
}

// Only start listening when run directly, so tests can import the app.
if (process.argv[1]?.includes('server')) {
  const app = createServer()
  connectDb(env.MONGODB_URI)
    .then(() => {
      app.listen(env.PORT, () => console.log(`api listening on ${env.PORT}`))
    })
    .catch((error) => {
      console.error('failed to start:', error)
      process.exit(1)
    })
}
