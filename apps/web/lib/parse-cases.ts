export type ParsedCase = { jd: string; companyUrl: string; days: number }

export const MAX_CASES = 20

/**
 * Accepts the same file the batch command reads, so a set of cases prepared
 * for `npm run evaluate` can be dropped straight into the interface. A bad row
 * is reported and skipped rather than rejecting the whole file — the same
 * posture the pipeline takes towards a bad source.
 */
export function parseCases(raw: string): { cases: ParsedCase[]; errors: string[] } {
  const errors: string[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { cases: [], errors: ['that file could not be read as JSON'] }
  }

  if (!Array.isArray(parsed)) {
    return { cases: [], errors: ['the file must contain an array of cases'] }
  }
  if (parsed.length === 0) {
    return { cases: [], errors: ['the file contained no cases'] }
  }

  const cases: ParsedCase[] = []
  parsed.forEach((row, index) => {
    if (cases.length >= MAX_CASES) return
    const record = (row ?? {}) as Record<string, unknown>

    const jd = typeof record.jd === 'string' ? record.jd.trim() : ''
    const companyUrl =
      typeof record.company_url === 'string'
        ? record.company_url.trim()
        : typeof record.companyUrl === 'string'
          ? record.companyUrl.trim()
          : ''
    const rawDays = record.days
    const days = rawDays === undefined ? 1 : Number(rawDays)

    if (jd.length === 0) {
      errors.push(`row ${index + 1}: no job description`)
      return
    }
    if (companyUrl.length === 0) {
      errors.push(`row ${index + 1}: no company website address`)
      return
    }
    if (!Number.isInteger(days) || days < 1) {
      errors.push(`row ${index + 1}: days must be a whole number of at least 1`)
      return
    }

    cases.push({ jd, companyUrl, days })
  })

  if (parsed.length > MAX_CASES) {
    errors.push(`only the first ${MAX_CASES} cases were taken from this file`)
  }

  return { cases, errors }
}
