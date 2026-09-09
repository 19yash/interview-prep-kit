'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, inputClass } from '@/components/ui/Field'
import { useAuth } from '@/lib/auth-context'

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { signIn, register, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const isRegister = mode === 'register'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setLocalError(null)

    // Checked here as well as on the server so the user is told before a round trip.
    if (isRegister && password.length < 10) {
      setLocalError('use at least 10 characters')
      return
    }

    setSubmitting(true)
    try {
      await (isRegister ? register(email, password) : signIn(email, password))
    } catch {
      // The context already holds the message; nothing to add here.
    } finally {
      setSubmitting(false)
    }
  }

  const shown = localError ?? error

  return (
    <div className="mx-auto max-w-md">
      <Card title={isRegister ? 'Create an account' : 'Sign in'}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" id="email">
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              className={inputClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field
            label="Password"
            id="password"
            hint={isRegister ? 'At least 10 characters.' : undefined}
          >
            <input
              id="password"
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {shown && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {shown}
            </p>
          )}

          <Button type="submit" loading={submitting} className="w-full">
            {isRegister ? 'Create account' : 'Sign in'}
          </Button>

          <p className="text-center text-sm text-slate-600">
            {isRegister ? 'Already have an account? ' : 'No account yet? '}
            <Link href={isRegister ? '/login' : '/register'} className="rounded font-medium text-indigo-700 hover:text-indigo-800">
              {isRegister ? 'Sign in' : 'Create one'}
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
