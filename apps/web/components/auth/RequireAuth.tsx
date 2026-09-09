'use client'

import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { StateBlock } from '@/components/ui/StateBlock'
import { useAuth } from '@/lib/auth-context'

/**
 * A client-side guard, because the session cookie belongs to the API's origin
 * and cannot be read here on the server. The API is the real boundary — every
 * protected endpoint refuses an unauthenticated request — so this exists to
 * avoid showing a signed-out visitor a broken page, not to enforce access.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login')
  }, [status, router])

  if (status === 'loading') return <StateBlock state="loading" title="Checking your session" />
  if (status === 'signedOut') return <StateBlock state="loading" title="Redirecting to sign in" />
  return <>{children}</>
}
