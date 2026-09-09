import { describe, expect, it, vi } from 'vitest'
import { createRunner } from '../src/pipeline/runner.js'

describe('createRunner', () => {
  it('starts with every step pending and no current step', () => {
    const runner = createRunner(['a', 'b'])
    expect(runner.progress().steps.map((s) => s.status)).toEqual(['pending', 'pending'])
    expect(runner.progress().current).toBeNull()
  })

  it('marks a successful step done and returns its value', async () => {
    const runner = createRunner(['a'])
    const result = await runner.run('a', async () => 42)
    expect(result).toEqual({ ok: true, value: 42 })
    expect(runner.progress().steps[0]!.status).toBe('done')
  })

  it('records elapsed milliseconds for a step', async () => {
    const runner = createRunner(['a'])
    await runner.run('a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 12))
    })
    expect(runner.progress().steps[0]!.ms).toBeGreaterThan(0)
  })

  it('isolates a thrown error into a failed step and a warning', async () => {
    const runner = createRunner(['a', 'b'])
    const result = await runner.run('a', async () => {
      throw new Error('step exploded')
    })
    expect(result.ok).toBe(false)
    expect(runner.progress().steps[0]!.status).toBe('failed')
    expect(runner.warnings()).toEqual([{ step: 'a', source: null, reason: 'step exploded' }])
  })

  it('continues to the next step after a failure', async () => {
    const runner = createRunner(['a', 'b'])
    await runner.run('a', async () => {
      throw new Error('nope')
    })
    const second = await runner.run('b', async () => 'fine')
    expect(second).toEqual({ ok: true, value: 'fine' })
  })

  it('records a skipped step with its reason', () => {
    const runner = createRunner(['a', 'b'])
    runner.skip('b', 'no hiring page was found')
    const step = runner.progress().steps[1]!
    expect(step.status).toBe('skipped')
    expect(step.detail).toBe('no hiring page was found')
  })

  it('reports progress before and after each step', async () => {
    const report = vi.fn()
    const runner = createRunner(['a'], report)
    await runner.run('a', async () => 1)
    const statuses = report.mock.calls.map((call) => call[0].steps[0].status)
    expect(statuses).toContain('running')
    expect(statuses).toContain('done')
  })

  it('names the running step as current while it runs', async () => {
    const seen: (string | null)[] = []
    const runner = createRunner(['a'], (p) => {
      seen.push(p.current)
    })
    await runner.run('a', async () => 1)
    expect(seen).toContain('a')
    expect(runner.progress().current).toBeNull()
  })

  it('does not fail the run when the progress reporter itself throws', async () => {
    const runner = createRunner(['a'], () => {
      throw new Error('reporter down')
    })
    await expect(runner.run('a', async () => 1)).resolves.toEqual({ ok: true, value: 1 })
  })
})
