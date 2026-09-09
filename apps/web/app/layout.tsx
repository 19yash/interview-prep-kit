import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { TopBar } from '@/components/nav/TopBar'
import { AuthProvider } from '@/lib/auth-context'
import './globals.css'

export const metadata: Metadata = {
  title: 'Interview Prep Kit',
  description: 'Turn a job description and a company website into a preparation kit you can work through.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <AuthProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
          >
            Skip to content
          </a>
          <TopBar />
          <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  )
}
