import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'

export function PracticeEmpty({ kitId }: { kitId: string }) {
  return (
    <StateBlock
      state="empty"
      title="No flashcards to practise"
      detail="This kit has no flashcards yet — either none were generated, or they were all deleted. Add one by hand on the kit page, or regenerate the flashcards."
      action={
        <Link href={`/kits/${kitId}`}>
          <Button variant="secondary">Back to the kit</Button>
        </Link>
      }
    />
  )
}
