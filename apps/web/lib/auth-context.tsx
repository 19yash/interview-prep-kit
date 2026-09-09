'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import type { User } from './types'

type Status = 'loading' | 'signedIn' | 'signedOut'

type AuthValue = {
  user: User | null
  status: Status
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/**
 * The session lives in the client because the cookie belongs to another
 * origin: a server component here cannot read it, so there is nothing to be
 * gained by pretending otherwise. The cost is a brief loading state on first
 * paint, which is why every page renders one rather than assuming a user.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((current) => {
        if (cancelled) return
        setUser(current)
        setStatus('signedIn')
      })
      .catch(() => {
        if (cancelled) return
        setUser(null)
        setStatus('signedOut')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(
    async (action: () => Promise<User>) => {
      setError(null)
      try {
        const current = await action()
        setUser(current)
        setStatus('signedIn')
        router.push('/kits')
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'something went wrong')
        throw caught
      }
    },
    [router],
  )

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      error,
      signIn: (email, password) => run(() => api.login(email, password)),
      register: (email, password) => run(() => api.register(email, password)),
      signOut: async () => {
        await api.logout().catch(() => {})
        setUser(null)
        setStatus('signedOut')
        router.push('/login')
      },
    }),
    [user, status, error, run, router],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
