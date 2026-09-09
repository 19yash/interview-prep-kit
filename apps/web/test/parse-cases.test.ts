import { describe, expect, it } from 'vitest'
import { parseCases } from '../lib/parse-cases.js'

describe('parseCases', () => {
  it('accepts the Appendix B field names', () => {
    const { cases, errors } = parseCases(
      JSON.stringify([{ id: 'case-01', jd: 'Senior Backend Engineer', company_url: 'https://acme.test/', days: 5 }]),
    )
    expect(errors).toEqual([])
    expect(cases).toEqual([{ jd: 'Senior Backend Engineer', companyUrl: 'https://acme.test/', days: 5 }])
  })

  it('accepts the camel-case names the form uses', () => {
    const { cases } = parseCases(JSON.stringify([{ jd: 'x', companyUrl: 'https://acme.test/', days: 2 }]))
    expect(cases[0]!.companyUrl).toBe('https://acme.test/')
  })

  it('defaults a missing day count to one', () => {
    const { cases } = parseCases(JSON.stringify([{ jd: 'x', company_url: 'https://acme.test/' }]))
    expect(cases[0]!.days).toBe(1)
  })

  it('reports a row with no job description and keeps the others', () => {
    const { cases, errors } = parseCases(
      JSON.stringify([
        { jd: '   ', company_url: 'https://a.test/' },
        { jd: 'good', company_url: 'https://b.test/' },
      ]),
    )
    expect(cases).toHaveLength(1)
    expect(errors[0]).toContain('row 1')
  })

  it('reports a row with no company url', () => {
    const { errors } = parseCases(JSON.stringify([{ jd: 'good' }]))
    expect(errors[0]).toContain('company')
  })

  it('reports a non-integer day count', () => {
    const { errors } = parseCases(JSON.stringify([{ jd: 'x', company_url: 'https://a.test/', days: 2.5 }]))
    expect(errors[0]).toContain('whole number')
  })

  it('rejects a file that is not an array', () => {
    const { cases, errors } = parseCases(JSON.stringify({ jd: 'x' }))
    expect(cases).toEqual([])
    expect(errors[0]).toContain('array')
  })

  it('reports unparseable json without throwing', () => {
    const { errors } = parseCases('{not json')
    expect(errors[0]).toContain('could not be read')
  })

  it('rejects an empty array', () => {
    const { errors } = parseCases('[]')
    expect(errors[0]).toContain('no cases')
  })

  it('caps the number of cases and says so', () => {
    const many = Array.from({ length: 25 }, () => ({ jd: 'x', company_url: 'https://a.test/', days: 1 }))
    const { cases, errors } = parseCases(JSON.stringify(many))
    expect(cases).toHaveLength(20)
    expect(errors.join(' ')).toContain('20')
  })
})
