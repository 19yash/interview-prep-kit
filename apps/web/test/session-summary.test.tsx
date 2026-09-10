import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionSummary } from '../components/practice/SessionSummary.js'
import type { Flashcard, Requirement } from '../lib/types.js'
import type { PracticeStats } from '../lib/practice-stats.js'

afterEach(() => {
  cleanup()
})

describe('SessionSummary', () => {
  const dummyStats: PracticeStats = {
    total: 3,
    seen: 3,
    unseen: 0,
    low: 1,
    medium: 1,
    high: 1,
    weakest: [],
    lastSeenAt: '2026-09-08T10:00:00Z',
  }

  const req1: Requirement = { id: 'r1', text: 'Distributed Systems and Go', kind: 'technical', priority: 'must' }
  const req2: Requirement = { id: 'r2', text: 'Leadership and Mentorship', kind: 'behavioural', priority: 'nice' }

  const card1: Flashcard = {
    id: 'c1',
    front: 'Raft consensus',
    back: 'Leader election, log replication',
    requirement_ids: ['r1'],
    origin: 'generated',
    pinned: false,
    rev: 0,
  }
  const card2: Flashcard = {
    id: 'c2',
    front: 'Handling junior engineers mistakes',
    back: 'Blameless retrospectives',
    requirement_ids: ['r2'],
    origin: 'generated',
    pinned: false,
    rev: 0,
  }

  it('renders requirements with calculated confidence scores', () => {
    const attempts = [
      { cardId: 'c1', confidence: 3, seenAt: '2026-09-08T10:00:00Z' },
      { cardId: 'c2', confidence: 1, seenAt: '2026-09-08T10:05:00Z' },
    ]

    render(
      <SessionSummary
        stats={dummyStats}
        ratedThisSession={2}
        onRestart={() => {}}
        kitId="kit-123"
        requirements={[req1, req2]}
        cards={[card1, card2]}
        practiceAttempts={attempts}
      />,
    )

    // Requirements section header
    expect(screen.getByText('Confidence against Role Requirements')).toBeDefined()
    expect(screen.getByText('Distributed Systems and Go')).toBeDefined()
    expect(screen.getByText('Leadership and Mentorship')).toBeDefined()

    // Status badges
    expect(screen.getAllByText('Confident').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Needs practice')).toBeDefined()

    // Scores
    expect(screen.getByText('3.0 / 3')).toBeDefined()
    expect(screen.getByText('1.0 / 3')).toBeDefined()
  })

  it('triggers onRestart when Practise again is clicked', () => {
    const onRestart = vi.fn()
    render(
      <SessionSummary
        stats={dummyStats}
        ratedThisSession={2}
        onRestart={onRestart}
        kitId="kit-123"
        requirements={[req1]}
        cards={[card1]}
        practiceAttempts={[]}
      />,
    )

    const restartBtn = screen.getByRole('button', { name: /Practise again/i })
    fireEvent.click(restartBtn)
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it('provides a link back to kit builder', () => {
    render(
      <SessionSummary
        stats={dummyStats}
        ratedThisSession={2}
        onRestart={() => {}}
        kitId="kit-456"
      />,
    )

    const link = screen.getByRole('link', { name: /Back to Kit Builder/i })
    expect(link.getAttribute('href')).toBe('/kits/kit-456')
  })
})
