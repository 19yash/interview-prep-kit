'use client'

import { QuestionList } from '@/components/kit/QuestionList'
import { CoverageNotice } from '@/components/kit/CoverageNotice'
import { CATEGORY_ORDER, groupByCategory } from '@/lib/kit-derive'
import type { Kit, SectionState } from '@/lib/types'
import type { Mutations } from '@/lib/use-kit-mutations'

export function QuestionBank({
  kit,
  mutations,
  sections,
}: {
  kit: Kit
  mutations: Mutations
  sections: Record<string, SectionState>
}) {
  const grouped = groupByCategory(kit.questions)

  return (
    <div className="space-y-4">
      <CoverageNotice kit={kit} />
      {CATEGORY_ORDER.map((category) => (
        <QuestionList
          key={category}
          category={category}
          questions={grouped[category]}
          kit={kit}
          mutations={mutations}
          sections={sections}
        />
      ))}
    </div>
  )
}
