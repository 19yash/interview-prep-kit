import { describe, expect, it } from 'vitest'
import { CasesSchema } from '../src/schema/batch.js'

describe('CasesSchema', () => {
  it('accepts the Appendix B input shape', () => {
    const parsed = CasesSchema.parse([
      { id: 'case-01', jd: 'Senior Backend Engineer\n\nWe are looking for ...', company_url: 'http://localhost:8099/acme/', days: 5 },
    ])
    expect(parsed[0]!.id).toBe('case-01')
    expect(parsed[0]!.days).toBe(5)
  })

  it('rejects a case with no id', () => {
    expect(() => CasesSchema.parse([{ jd: 'x', company_url: 'http://x.test/', days: 1 }])).toThrow()
  })

  it('rejects a non-integer day count', () => {
    expect(() => CasesSchema.parse([{ id: 'a', jd: 'x', company_url: 'http://x.test/', days: 2.5 }])).toThrow()
  })

  it('defaults a missing day count to one rather than failing the file', () => {
    const parsed = CasesSchema.parse([{ id: 'a', jd: 'x', company_url: 'http://x.test/' }])
    expect(parsed[0]!.days).toBe(1)
  })

  it('rejects a file that is not an array', () => {
    expect(() => CasesSchema.parse({ id: 'a' })).toThrow()
  })
})
