import { createStubClient, type LlmClient } from '@ipk/core'
import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectDb, disconnectDb } from '../src/db.js'
import { setTestLlm, waitForIdle } from '../src/jobs/queue.js'
import { createServer } from '../src/server.js'

function workingLlm(): LlmClient {
  return createStubClient({
    grounded: { text: '', sources: [] },
    json: (call) => {
      if (call.prompt.includes('JOB_DESCRIPTION')) {
        return {
          title: 'Engineer',
          seniority: 'mid',
          location: 'Remote',
          company_guess: 'Acme',
          responsibilities: ['Ship'],
          requirements: [{ text: 'Node.js', kind: 'technical', priority: 'must' }],
        }
      }
      if (call.prompt.includes('Category: technical')) {
        return { questions: [{ requirement_ids: ['r1'], prompt: 'Event loop?', answer_outline: 'phases', difficulty: 2 }] }
      }
      if (call.prompt.includes('Category:')) return { questions: [] }
      if (call.prompt.includes('Write flashcards')) return { flashcards: [{ front: 'f', back: 'b', requirement_ids: ['r1'] }] }
      if (call.prompt.includes('Write a brief about')) return { summary: 's', what_they_do: 'w' }
      return {}
    },
  })
}

let mongo: MongoMemoryServer
const app = createServer()
const agent = request.agent(app)
const jd = 'Senior Backend Engineer. '.repeat(40)
const companyUrl = 'http://127.0.0.1:1/'

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.JWT_SECRET = 'test-secret'
  await connectDb(mongo.getUri())
  setTestLlm(workingLlm())
  await agent.post('/api/auth/register').send({ email: 'kits@test.dev', password: 'correct horse battery' })
}, 60_000)

afterAll(async () => {
  setTestLlm(null)
  await disconnectDb()
  await mongo.stop()
})

describe('kit creation', () => {
  it('refuses to create a kit without a session', async () => {
    const response = await request(app).post('/api/kits').send({ jd, companyUrl, days: 3 })
    expect(response.status).toBe(401)
  })

  it('accepts a creation request immediately rather than blocking on generation', async () => {
    const started = Date.now()
    const response = await agent.post('/api/kits').send({ jd, companyUrl, days: 3 })
    expect(response.status).toBe(202)
    expect(response.body.id).toBeTruthy()
    expect(response.body.status).toBe('queued')
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('rejects an empty job description', async () => {
    const response = await agent.post('/api/kits').send({ jd: '  ', companyUrl, days: 3 })
    expect(response.status).toBe(400)
  })

  it('rejects a day count that is not a positive integer', async () => {
    expect((await agent.post('/api/kits').send({ jd, companyUrl, days: 0 })).status).toBe(400)
    expect((await agent.post('/api/kits').send({ jd, companyUrl, days: 2.5 })).status).toBe(400)
  })

  it('returns the existing kit when the same posting is submitted twice', async () => {
    const first = await agent.post('/api/kits').send({ jd: `${jd} duplicate`, companyUrl, days: 4 })
    const second = await agent.post('/api/kits').send({ jd: `${jd} duplicate`, companyUrl, days: 4 })
    expect(first.status).toBe(202)
    expect(second.status).toBe(200)
    expect(second.body.id).toBe(first.body.id)
    expect(second.body.duplicate).toBe(true)
  })

  it('runs the pipeline and reaches a terminal status with a valid kit', async () => {
    const created = await agent.post('/api/kits').send({ jd: `${jd} terminal`, companyUrl, days: 3 })
    await waitForIdle()
    const response = await agent.get(`/api/kits/${created.body.id}`)
    expect(response.status).toBe(200)
    expect(['ready', 'partial']).toContain(response.body.status)
    expect(response.body.kit.schedule.days).toHaveLength(3)
    expect(response.body.progress.steps.length).toBeGreaterThan(0)
  })

  it('records an unreachable company site as a warning without failing the kit', async () => {
    const created = await agent.post('/api/kits').send({ jd: `${jd} unreachable`, companyUrl, days: 2 })
    await waitForIdle()
    const response = await agent.get(`/api/kits/${created.body.id}`)
    expect(response.body.status).not.toBe('failed')
    expect(response.body.kit.warnings.length).toBeGreaterThan(0)
  })

  it('marks a kit failed with a code when the pipeline cannot produce one', async () => {
    setTestLlm({
      generateJson: async () => {
        throw new Error('provider down')
      },
      generateGrounded: async () => {
        throw new Error('provider down')
      },
    })
    const created = await agent.post('/api/kits').send({ jd: `${jd} failing`, companyUrl, days: 2 })
    await waitForIdle()
    const response = await agent.get(`/api/kits/${created.body.id}`)
    expect(response.body.status).toBe('failed')
    expect(response.body.error.code).toBe('EXTRACTION_FAILED')
    setTestLlm(workingLlm())
  })

  it('creates one kit per case from a batch upload', async () => {
    const response = await agent.post('/api/kits/batch').send({
      cases: [
        { jd: `${jd} batch one`, companyUrl, days: 2 },
        { jd: `${jd} batch two`, companyUrl, days: 3 },
      ],
    })
    expect(response.status).toBe(202)
    expect(response.body.ids).toHaveLength(2)
  })

  it('rejects a batch upload that is not an array of cases', async () => {
    expect((await agent.post('/api/kits/batch').send({ cases: 'nope' })).status).toBe(400)
  })
})

describe('kit access', () => {
  it('lists only the signed-in user’s kits, without their bodies', async () => {
    const response = await agent.get('/api/kits')
    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.kits)).toBe(true)
    expect(response.body.kits[0].kit).toBeUndefined()
    expect(response.body.kits[0].role).toBeDefined()
  })

  it('does not return another user’s kit', async () => {
    const created = await agent.post('/api/kits').send({ jd: `${jd} private`, companyUrl, days: 2 })
    const other = request.agent(app)
    await other.post('/api/auth/register').send({ email: 'other@test.dev', password: 'correct horse battery' })
    const response = await other.get(`/api/kits/${created.body.id}`)
    expect(response.status).toBe(404)
  })

  it('does not list another user’s kits', async () => {
    const other = request.agent(app)
    await other.post('/api/auth/login').send({ email: 'other@test.dev', password: 'correct horse battery' })
    const response = await other.get('/api/kits')
    expect(response.body.kits).toEqual([])
  })

  it('returns 404 for a malformed id rather than a 500', async () => {
    expect((await agent.get('/api/kits/not-an-object-id')).status).toBe(404)
  })

  it('deletes the user’s own kit', async () => {
    const created = await agent.post('/api/kits').send({ jd: `${jd} deletable`, companyUrl, days: 2 })
    expect((await agent.delete(`/api/kits/${created.body.id}`)).status).toBe(204)
    expect((await agent.get(`/api/kits/${created.body.id}`)).status).toBe(404)
  })

  it('will not delete someone else’s kit', async () => {
    const created = await agent.post('/api/kits').send({ jd: `${jd} undeletable`, companyUrl, days: 2 })
    const other = request.agent(app)
    await other.post('/api/auth/login').send({ email: 'other@test.dev', password: 'correct horse battery' })
    expect((await other.delete(`/api/kits/${created.body.id}`)).status).toBe(404)
  })
})
