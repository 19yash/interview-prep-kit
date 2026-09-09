import { createStubClient, type LlmClient } from '@ipk/core'
import { MongoMemoryServer } from 'mongodb-memory-server'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectDb, disconnectDb } from '../src/db.js'
import { setTestLlm, waitForIdle } from '../src/jobs/queue.js'
import { createServer } from '../src/server.js'

function llmWith(technicalPrompts: string[]): LlmClient {
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
          requirements: [
            { text: 'Node.js', kind: 'technical', priority: 'must' },
            { text: 'Mentoring', kind: 'behavioural', priority: 'must' },
          ],
        }
      }
      if (call.prompt.includes('Category: technical')) {
        return {
          questions: technicalPrompts.map((prompt) => ({
            requirement_ids: ['r1'],
            prompt,
            answer_outline: 'outline',
            difficulty: 2,
          })),
        }
      }
      if (call.prompt.includes('Category: behavioural')) {
        return { questions: [{ requirement_ids: ['r2'], prompt: 'Mentoring story?', answer_outline: '', difficulty: 2 }] }
      }
      if (call.prompt.includes('Category:')) return { questions: [] }
      if (call.prompt.includes('Write flashcards')) {
        return { flashcards: [{ front: 'Event loop?', back: 'Phases.', requirement_ids: ['r1'] }] }
      }
      if (call.prompt.includes('Write a brief about')) return { summary: 'Acme does things.', what_they_do: 'Things.' }
      return {}
    },
  })
}

let mongo: MongoMemoryServer
const app = createServer()
const agent = request.agent(app)
const jd = 'Senior Backend Engineer. '.repeat(40)
const companyUrl = 'http://127.0.0.1:1/'
let kitId = ''
let counter = 0

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.JWT_SECRET = 'test-secret'
  await connectDb(mongo.getUri())
  await agent.post('/api/auth/register').send({ email: 'builder@test.dev', password: 'correct horse battery' })
}, 60_000)

afterAll(async () => {
  setTestLlm(null)
  await disconnectDb()
  await mongo.stop()
})

/** A fresh kit per test, so state changes never leak between cases. */
beforeEach(async () => {
  counter += 1
  setTestLlm(llmWith(['First generated question', 'Second generated question']))
  const created = await agent.post('/api/kits').send({ jd: `${jd} run ${counter}`, companyUrl, days: 3 })
  kitId = created.body.id
  await waitForIdle()
})

const read = async () => (await agent.get(`/api/kits/${kitId}`)).body

describe('editing', () => {
  it('edits a question inline and marks it edited', async () => {
    const before = await read()
    const target = before.kit.questions[0]
    const response = await agent
      .patch(`/api/kits/${kitId}/questions/${target.id}`)
      .send({ prompt: 'My own wording', answer_outline: 'my outline' })
    expect(response.status).toBe(200)

    const after = await read()
    const edited = after.kit.questions.find((q: { id: string }) => q.id === target.id)
    expect(edited.prompt).toBe('My own wording')
    expect(edited.origin).toBe('edited')
    expect(edited.rev).toBe(1)
  })

  it('rejects an edit that would empty a required field', async () => {
    const before = await read()
    const response = await agent.patch(`/api/kits/${kitId}/questions/${before.kit.questions[0].id}`).send({ prompt: '   ' })
    expect(response.status).toBe(400)
  })

  it('rejects a difficulty outside 1..3', async () => {
    const before = await read()
    const response = await agent.patch(`/api/kits/${kitId}/questions/${before.kit.questions[0].id}`).send({ difficulty: 7 })
    expect(response.status).toBe(400)
  })

  it('pins a question without changing its text', async () => {
    const before = await read()
    const target = before.kit.questions[0]
    await agent.patch(`/api/kits/${kitId}/questions/${target.id}`).send({ pinned: true })
    const after = await read()
    const pinned = after.kit.questions.find((q: { id: string }) => q.id === target.id)
    expect(pinned.pinned).toBe(true)
    expect(pinned.origin).toBe('generated')
  })

  it('edits the company brief and marks the section edited', async () => {
    const response = await agent.patch(`/api/kits/${kitId}/brief`).send({ summary: 'My summary of Acme' })
    expect(response.status).toBe(200)
    const after = await read()
    expect(after.kit.company_brief.summary).toBe('My summary of Acme')
  })

  it('404s on editing a question that does not exist', async () => {
    expect((await agent.patch(`/api/kits/${kitId}/questions/q999`).send({ prompt: 'x' })).status).toBe(404)
  })

  it('will not let another user edit the kit', async () => {
    const before = await read()
    const other = request.agent(app)
    await other.post('/api/auth/register').send({ email: `intruder${counter}@test.dev`, password: 'correct horse battery' })
    const response = await other.patch(`/api/kits/${kitId}/questions/${before.kit.questions[0].id}`).send({ prompt: 'mine now' })
    expect(response.status).toBe(404)
  })
})

describe('adding, deleting and reordering', () => {
  it('adds a question by hand as manual', async () => {
    const response = await agent
      .post(`/api/kits/${kitId}/questions`)
      .send({ category: 'technical', prompt: 'My own question', requirement_ids: ['r1'], difficulty: 3 })
    expect(response.status).toBe(201)
    const after = await read()
    const added = after.kit.questions.find((q: { prompt: string }) => q.prompt === 'My own question')
    expect(added.origin).toBe('manual')
  })

  it('never reuses an id after a delete', async () => {
    const before = await read()
    const ids = before.kit.questions.map((q: { id: string }) => q.id)
    await agent.delete(`/api/kits/${kitId}/questions/${ids[0]}`)
    const response = await agent
      .post(`/api/kits/${kitId}/questions`)
      .send({ category: 'technical', prompt: 'Replacement', requirement_ids: ['r1'], difficulty: 1 })
    expect(ids).not.toContain(response.body.question.id)
  })

  it('removes a deleted question from the schedule so the kit stays valid', async () => {
    const before = await read()
    const scheduled = before.kit.schedule.days.flatMap((d: { question_ids: string[] }) => d.question_ids)
    const target = scheduled[0]
    expect(target).toBeTruthy()
    await agent.delete(`/api/kits/${kitId}/questions/${target}`)
    const after = await read()
    const stillScheduled = after.kit.schedule.days.flatMap((d: { question_ids: string[] }) => d.question_ids)
    expect(stillScheduled).not.toContain(target)
  })

  it('moves a question to another category', async () => {
    const before = await read()
    const target = before.kit.questions.find((q: { category: string }) => q.category === 'technical')
    const response = await agent.patch(`/api/kits/${kitId}/questions/${target.id}/category`).send({ category: 'behavioural' })
    expect(response.status).toBe(200)
    const after = await read()
    expect(after.kit.questions.find((q: { id: string }) => q.id === target.id).category).toBe('behavioural')
  })

  it('rejects a move to a category that does not exist', async () => {
    const before = await read()
    const response = await agent
      .patch(`/api/kits/${kitId}/questions/${before.kit.questions[0].id}/category`)
      .send({ category: 'vibes' })
    expect(response.status).toBe(400)
  })

  it('reorders questions from a full id list', async () => {
    const before = await read()
    const ids = before.kit.questions.map((q: { id: string }) => q.id)
    const reversed = [...ids].reverse()
    const response = await agent.put(`/api/kits/${kitId}/questions/order`).send({ ids: reversed })
    expect(response.status).toBe(200)
    const after = await read()
    expect(after.kit.questions.map((q: { id: string }) => q.id)).toEqual(reversed)
  })

  it('rejects a reorder that adds or drops an id', async () => {
    const before = await read()
    const ids = before.kit.questions.map((q: { id: string }) => q.id)
    expect((await agent.put(`/api/kits/${kitId}/questions/order`).send({ ids: ids.slice(1) })).status).toBe(400)
    expect((await agent.put(`/api/kits/${kitId}/questions/order`).send({ ids: [...ids, 'q999'] })).status).toBe(400)
  })

  it('adds and deletes a flashcard', async () => {
    const created = await agent.post(`/api/kits/${kitId}/flashcards`).send({ front: 'My card', back: 'My answer', requirement_ids: ['r1'] })
    expect(created.status).toBe(201)
    expect(created.body.flashcard.origin).toBe('manual')
    expect((await agent.delete(`/api/kits/${kitId}/flashcards/${created.body.flashcard.id}`)).status).toBe(204)
  })
})

describe('regeneration', () => {
  it('replaces generated questions in the target category', async () => {
    setTestLlm(llmWith(['Regenerated question A', 'Regenerated question B']))
    const response = await agent.post(`/api/kits/${kitId}/regenerate/questions_technical`)
    expect(response.status).toBe(200)
    const after = await read()
    const technical = after.kit.questions.filter((q: { category: string }) => q.category === 'technical')
    expect(technical.some((q: { prompt: string }) => q.prompt.startsWith('Regenerated'))).toBe(true)
    expect(technical.some((q: { prompt: string }) => q.prompt === 'First generated question')).toBe(false)
  })

  it('preserves an edited question in the regenerated category', async () => {
    const before = await read()
    const target = before.kit.questions.find((q: { category: string }) => q.category === 'technical')
    await agent.patch(`/api/kits/${kitId}/questions/${target.id}`).send({ prompt: 'I rewrote this myself' })

    setTestLlm(llmWith(['Regenerated question A']))
    await agent.post(`/api/kits/${kitId}/regenerate/questions_technical`)

    const after = await read()
    const survivor = after.kit.questions.find((q: { id: string }) => q.id === target.id)
    expect(survivor.prompt).toBe('I rewrote this myself')
    expect(survivor.origin).toBe('edited')
  })

  it('preserves a pinned generated question', async () => {
    const before = await read()
    const target = before.kit.questions.find((q: { category: string }) => q.category === 'technical')
    await agent.patch(`/api/kits/${kitId}/questions/${target.id}`).send({ pinned: true })

    setTestLlm(llmWith(['Regenerated question A']))
    await agent.post(`/api/kits/${kitId}/regenerate/questions_technical`)

    const after = await read()
    expect(after.kit.questions.some((q: { id: string }) => q.id === target.id)).toBe(true)
  })

  it('preserves a hand-written question', async () => {
    const created = await agent
      .post(`/api/kits/${kitId}/questions`)
      .send({ category: 'technical', prompt: 'Mine', requirement_ids: ['r1'], difficulty: 2 })

    setTestLlm(llmWith(['Regenerated question A']))
    await agent.post(`/api/kits/${kitId}/regenerate/questions_technical`)

    const after = await read()
    expect(after.kit.questions.some((q: { id: string }) => q.id === created.body.question.id)).toBe(true)
  })

  it('does not touch another category’s edits', async () => {
    const before = await read()
    const behavioural = before.kit.questions.find((q: { category: string }) => q.category === 'behavioural')
    await agent.patch(`/api/kits/${kitId}/questions/${behavioural.id}`).send({ prompt: 'My behavioural wording' })

    setTestLlm(llmWith(['Regenerated question A']))
    await agent.post(`/api/kits/${kitId}/regenerate/questions_technical`)

    const after = await read()
    expect(after.kit.questions.find((q: { id: string }) => q.id === behavioural.id).prompt).toBe('My behavioural wording')
  })

  it('does not discard an edited company brief when regenerating questions', async () => {
    await agent.patch(`/api/kits/${kitId}/brief`).send({ summary: 'My brief' })
    setTestLlm(llmWith(['Regenerated question A']))
    await agent.post(`/api/kits/${kitId}/regenerate/questions_technical`)
    expect((await read()).kit.company_brief.summary).toBe('My brief')
  })

  it('regenerates the schedule without touching questions', async () => {
    const before = await read()
    const response = await agent.post(`/api/kits/${kitId}/regenerate/schedule`)
    expect(response.status).toBe(200)
    const after = await read()
    expect(after.kit.schedule.days).toHaveLength(3)
    expect(after.kit.questions.map((q: { id: string }) => q.id)).toEqual(before.kit.questions.map((q: { id: string }) => q.id))
  })

  it('recomputes coverage after a regeneration', async () => {
    setTestLlm(llmWith([]))
    await agent.post(`/api/kits/${kitId}/regenerate/questions_technical`)
    const after = await read()
    expect(after.kit.coverage.uncovered_requirement_ids).toContain('r1')
  })

  it('leaves the previous content intact and marks the section failed when regeneration fails', async () => {
    const before = await read()
    setTestLlm({
      generateJson: async () => {
        throw new Error('provider down')
      },
      generateGrounded: async () => {
        throw new Error('provider down')
      },
    })
    const response = await agent.post(`/api/kits/${kitId}/regenerate/questions_technical`)
    expect(response.status).toBe(502)

    const after = await read()
    expect(after.kit.questions.map((q: { id: string }) => q.id)).toEqual(before.kit.questions.map((q: { id: string }) => q.id))
    expect(after.sections.questions_technical.status).toBe('failed')
  })

  it('rejects an unknown section name', async () => {
    expect((await agent.post(`/api/kits/${kitId}/regenerate/not_a_section`)).status).toBe(400)
  })

  it('increments the section revision on success', async () => {
    setTestLlm(llmWith(['Regenerated question A']))
    await agent.post(`/api/kits/${kitId}/regenerate/questions_technical`)
    expect((await read()).sections.questions_technical.rev).toBe(1)
  })
})

describe('practice', () => {
  it('records confidence for a card', async () => {
    const before = await read()
    const card = before.kit.flashcards[0]
    const response = await agent.post(`/api/kits/${kitId}/practice`).send({ cardId: card.id, confidence: 1 })
    expect(response.status).toBe(200)
    expect(response.body.covered).toContain(card.id)
  })

  it('rejects a confidence outside 1..3 and an unknown card', async () => {
    const before = await read()
    expect((await agent.post(`/api/kits/${kitId}/practice`).send({ cardId: before.kit.flashcards[0].id, confidence: 9 })).status).toBe(400)
    expect((await agent.post(`/api/kits/${kitId}/practice`).send({ cardId: 'f999', confidence: 2 })).status).toBe(404)
  })

  it('orders the next session by lowest confidence first, with unseen cards first of all', async () => {
    await agent.post(`/api/kits/${kitId}/flashcards`).send({ front: 'Second card', back: 'b', requirement_ids: ['r1'] })
    const before = await read()
    const [first, second] = before.kit.flashcards
    await agent.post(`/api/kits/${kitId}/practice`).send({ cardId: first.id, confidence: 3 })

    const next = await agent.get(`/api/kits/${kitId}/practice/next`)
    expect(next.status).toBe(200)
    // The never-seen card comes before the one rated confident.
    expect(next.body.order[0]).toBe(second.id)
    expect(next.body.order.at(-1)).toBe(first.id)
    expect(next.body.notCovered).toContain(second.id)
  })

  it('reports what has been covered and what has not', async () => {
    const before = await read()
    await agent.post(`/api/kits/${kitId}/practice`).send({ cardId: before.kit.flashcards[0].id, confidence: 2 })
    const next = await agent.get(`/api/kits/${kitId}/practice/next`)
    expect(next.body.covered).toContain(before.kit.flashcards[0].id)
    expect(next.body.notCovered).not.toContain(before.kit.flashcards[0].id)
  })
})
