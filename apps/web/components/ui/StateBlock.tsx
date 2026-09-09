import type { ReactNode } from 'react'
import { Spinner } from './Spinner'

/**
 * One component for the three states every fetching view needs, so no view
 * can quietly ship without an empty or error case.
 */
export function StateBlock({
  state,
  title,
  detail,
  action,
}: {
  state: 'loading' | 'empty' | 'error'
  title: string
  detail?: string
  action?: ReactNode
}) {
  const tone = state === 'error' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'
  return (
    <div className={`rounded-lg border px-4 py-10 text-center ${tone}`}>
      {state === 'loading' ? (
        <div className="flex justify-center">
          <Spinner label={title} />
        </div>
      ) : (
        <p className={`text-sm font-medium ${state === 'error' ? 'text-red-800' : 'text-slate-800'}`}>{title}</p>
      )}
      {detail && <p className={`mx-auto mt-2 max-w-prose text-sm ${state === 'error' ? 'text-red-700' : 'text-slate-600'}`}>{detail}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
