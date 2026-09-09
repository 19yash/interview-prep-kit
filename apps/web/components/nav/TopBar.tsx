'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth-context'

export function TopBar() {
  const { user, status, signOut } = useAuth()

  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="rounded text-sm font-semibold tracking-tight text-slate-900">
          Interview Prep Kit
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {status === 'signedIn' && user ? (
            <>
              <Link href="/kits" className="rounded px-1 text-slate-700 hover:text-slate-900">
                My kits
              </Link>
              <Link href="/kits/new" className="rounded px-1 text-slate-700 hover:text-slate-900">
                New kit
              </Link>
              <span className="hidden text-xs text-slate-500 sm:inline">{user.email}</span>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : status === 'signedOut' ? (
            <>
              <Link href="/login" className="rounded px-1 text-slate-700 hover:text-slate-900">
                Sign in
              </Link>
              <Link href="/register" className="rounded px-1 font-medium text-indigo-700 hover:text-indigo-800">
                Create account
              </Link>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  )
}
