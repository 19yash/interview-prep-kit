'use client'

import { useRouter } from 'next/navigation'
import { useState, type ChangeEvent } from 'react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { parseCases, type ParsedCase } from '@/lib/parse-cases'
import { pluralise } from '@/lib/format'

export function BatchUpload() {
  const router = useRouter()
  const [cases, setCases] = useState<ParsedCase[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    const { cases: parsed, errors } = parseCases(await file.text())
    setCases(parsed)
    setProblems(errors)
  }

  async function onSubmit() {
    setError(null)
    setSubmitting(true)
    try {
      const ids = await api.createBatch(cases)
      // Straight to the list: several kits are now generating at once, and the
      // list is the view that shows all of them advancing.
      router.push(ids.length === 1 ? `/kits/${ids[0]}` : '/kits')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card title="Prepare for several roles at once">
      <div className="space-y-4">
        <p className="max-w-prose text-sm text-slate-600">
          Upload a JSON array of cases. The same file the batch command reads works here:{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            {'[{ "jd": "...", "company_url": "https://...", "days": 5 }]'}
          </code>
        </p>

        <div>
          <label htmlFor="cases" className="block text-sm font-medium text-slate-800">
            Cases file
          </label>
          <input
            id="cases"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void onFile(event)}
            className="mt-1.5 block w-full cursor-pointer rounded-md border border-slate-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
          />
        </div>

        {problems.length > 0 && (
          <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        {cases.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">
              {pluralise(cases.length, 'case')} ready.
            </p>
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 text-sm">
              {cases.map((item, index) => (
                <li key={`${item.companyUrl}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                  <span className="truncate text-slate-800">{item.companyUrl}</span>
                  <span className="text-xs text-slate-500">
                    {item.jd.trim().length.toLocaleString()} chars · {pluralise(item.days, 'day')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <Button onClick={() => void onSubmit()} disabled={cases.length === 0} loading={submitting}>
          {submitting ? 'Starting' : `Build ${pluralise(cases.length, 'kit')}`}
        </Button>
      </div>
    </Card>
  )
}
