'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, inputClass } from '@/components/ui/Field'

export function CreateKitForm() {
  const router = useRouter()
  const [jd, setJd] = useState('')
  const [companyUrl, setCompanyUrl] = useState('')
  const [days, setDays] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      const created = await api.createKit({ jd, companyUrl, days })
      // The API returns the existing job for a repeat submission rather than
      // starting a second one, so say so instead of pretending it is new.
      if (created.duplicate) setNotice('You have already started this one — opening it.')
      router.push(`/kits/${created.id}`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card title="Prepare for one role">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Job description" id="jd" hint="Paste the posting text. Job boards block automated access, so this is not fetched for you.">
          <textarea
            id="jd"
            required
            rows={12}
            className={`${inputClass} font-mono text-xs leading-relaxed`}
            placeholder="Senior Backend Engineer&#10;&#10;We are looking for..."
            value={jd}
            onChange={(event) => setJd(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-[2fr,1fr]">
          <Field label="Company website" id="companyUrl" hint="The homepage is enough — the careers page is found by crawling.">
            <input
              id="companyUrl"
              required
              className={inputClass}
              placeholder="https://example.com"
              value={companyUrl}
              onChange={(event) => setCompanyUrl(event.target.value)}
            />
          </Field>

          <Field label="Days until the interview" id="days">
            <input
              id="days"
              type="number"
              min={1}
              max={60}
              required
              className={inputClass}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
          </Field>
        </div>

        <p className="text-xs text-slate-500">
          {jd.trim().length < 400
            ? 'Short descriptions produce short kits — the kit will say so rather than padding itself out.'
            : `${jd.trim().length.toLocaleString()} characters of description.`}
        </p>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        {notice && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{notice}</p>}

        <Button type="submit" loading={submitting}>
          {submitting ? 'Starting' : 'Build my kit'}
        </Button>
      </form>
    </Card>
  )
}
