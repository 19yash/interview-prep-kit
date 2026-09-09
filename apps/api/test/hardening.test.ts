import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectDb, disconnectDb } from '../src/db.js'
import { parseOrigins } from '../src/env.js'
import { createServer } from '../src/server.js'

let mongo: MongoMemoryServer
let app: ReturnType<typeof createServer>

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.JWT_SECRET = 'test-secret'
  await connectDb(mongo.getUri())
  app = createServer()
}, 60_000)

afterAll(async () => {
  await disconnectDb()
  await mongo.stop()
})

describe('parseOrigins', () => {
  it('reads a single origin', () => {
    expect(parseOrigins('https://app.test')).toEqual(['https://app.test'])
  })

  it('reads a comma-separated list and trims it', () => {
    expect(parseOrigins('https://a.test, https://b.test')).toEqual(['https://a.test', 'https://b.test'])
  })

  it('drops empty entries and a trailing slash', () => {
    expect(parseOrigins('https://a.test/,,  ')).toEqual(['https://a.test'])
  })

  it('returns an empty list for an empty value', () => {
    expect(parseOrigins('')).toEqual([])
  })
})

describe('hardening', () => {
  it('trusts the proxy, so a secure cookie can be set behind Render’s edge', () => {
    expect(app.get('trust proxy')).toBe(1)
  })

  it('reports database state on the health check rather than only process liveness', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('database')
    expect(response.body.database).toBe('connected')
  })

  it('rejects a request from an origin that is not allowed', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://not-allowed.test')
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('allows a configured origin with credentials', async () => {
    process.env.WEB_ORIGIN = 'http://localhost:3000'
    const fresh = createServer()
    const response = await request(fresh).get('/api/health').set('Origin', 'http://localhost:3000')
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('rate limits repeated login attempts', async () => {
    const fresh = createServer()
    const attempts = []
    for (let i = 0; i < 55; i += 1) {
      attempts.push(
        await request(fresh)
          .post('/api/auth/login')
          .send({ email: 'nonexistent@b.test', password: 'wrong' }),
      )
    }
    expect(attempts.some((response) => response.status === 429)).toBe(true)
  })

  it('does not rate limit ordinary reads', async () => {
    const fresh = createServer()
    for (let i = 0; i < 15; i += 1) {
      const response = await request(fresh).get('/api/health')
      expect(response.status).toBe(200)
    }
  })
})
