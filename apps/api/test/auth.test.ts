import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectDb, disconnectDb } from '../src/db.js'
import { createServer } from '../src/server.js'

let mongo: MongoMemoryServer
const app = createServer()

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.JWT_SECRET = 'test-secret'
  await connectDb(mongo.getUri())
}, 60_000)

afterAll(async () => {
  await disconnectDb()
  await mongo.stop()
})

const creds = { email: 'a@b.test', password: 'correct horse battery' }

describe('auth', () => {
  it('registers a user and sets a session cookie', async () => {
    const response = await request(app).post('/api/auth/register').send(creds)
    expect(response.status).toBe(201)
    expect(response.headers['set-cookie']?.[0]).toContain('ipk_session=')
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly')
    expect(response.body.user.email).toBe(creds.email)
    expect(response.body.user.passwordHash).toBeUndefined()
  })

  it('rejects a duplicate registration', async () => {
    const response = await request(app).post('/api/auth/register').send(creds)
    expect(response.status).toBe(409)
  })

  it('rejects a short password', async () => {
    const response = await request(app).post('/api/auth/register').send({ email: 'c@d.test', password: 'short' })
    expect(response.status).toBe(400)
  })

  it('rejects a malformed email', async () => {
    const response = await request(app).post('/api/auth/register').send({ email: 'not-an-email', password: 'long enough password' })
    expect(response.status).toBe(400)
  })

  it('logs in with the right password', async () => {
    const response = await request(app).post('/api/auth/login').send(creds)
    expect(response.status).toBe(200)
    expect(response.headers['set-cookie']?.[0]).toContain('ipk_session=')
  })

  it('rejects the wrong password with the same message as an unknown email', async () => {
    const wrongPassword = await request(app).post('/api/auth/login').send({ ...creds, password: 'wrong password here' })
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'nobody@x.test', password: 'wrong password here' })
    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message)
  })

  it('returns the current user when the cookie is present', async () => {
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send(creds)
    const response = await agent.get('/api/auth/me')
    expect(response.status).toBe(200)
    expect(response.body.user.email).toBe(creds.email)
  })

  it('rejects an unauthenticated request to a protected route', async () => {
    const response = await request(app).get('/api/auth/me')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('rejects a forged or expired token and clears the cookie', async () => {
    const response = await request(app).get('/api/auth/me').set('Cookie', 'ipk_session=not-a-real-token')
    expect(response.status).toBe(401)
    expect(response.headers['set-cookie']?.[0]).toContain('ipk_session=;')
  })

  it('clears the cookie on logout', async () => {
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send(creds)
    const response = await agent.post('/api/auth/logout')
    expect(response.status).toBe(204)
    const after = await agent.get('/api/auth/me')
    expect(after.status).toBe(401)
  })

  it('answers the health check without authentication', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
  })
})
