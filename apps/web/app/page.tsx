'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { StateBlock } from '@/components/ui/StateBlock'
import { useAuth } from '@/lib/auth-context'

export default function HomePage() {
  const { status } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (status === 'signedIn') router.replace('/kits')
    if (status === 'signedOut') router.replace('/login')
  }, [status, router])

  return <StateBlock state="loading" title="Loading your session" />
}
