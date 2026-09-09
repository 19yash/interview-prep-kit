'use client'

import { useState } from 'react'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { BatchUpload } from '@/components/kits/BatchUpload'
import { CreateKitForm } from '@/components/kits/CreateKitForm'

type Tab = 'single' | 'batch'

function NewKit() {
  const [tab, setTab] = useState<Tab>('single')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">New kit</h1>

      <div role="tablist" aria-label="How many roles" className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
        {(['single', 'batch'] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${tab === value ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
          >
            {value === 'single' ? 'One role' : 'Several roles'}
          </button>
        ))}
      </div>

      {tab === 'single' ? <CreateKitForm /> : <BatchUpload />}
    </div>
  )
}

export default function NewKitPage() {
  return (
    <RequireAuth>
      <NewKit />
    </RequireAuth>
  )
}
