#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CasesSchema, runBatch } from '@ipk/core'

// The documented setup is a .env file, so read it before anything touches
// process.env. Node loads it natively; an absent or unreadable file is fine,
// because the variables may equally be exported by the shell or the host.
try {
  process.loadEnvFile?.(resolve('.env'))
} catch {
  /* no .env present; fall back to the ambient environment */
}

type Args = { input: string; output: string; concurrency?: number }

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else {
      args[key] = 'true'
    }
  }
  if (!args.input || !args.output) {
    console.error('usage: npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency 2]')
    process.exit(2)
  }
  return {
    input: args.input,
    output: args.output,
    concurrency: args.concurrency ? Number(args.concurrency) : undefined,
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const raw = await readFile(resolve(args.input), 'utf8')
  let cases
  try {
    cases = CasesSchema.parse(JSON.parse(raw))
  } catch (error) {
    console.error(`could not read cases from ${args.input}: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
    return
  }

  const started = Date.now()
  console.log(`running ${cases.length} case(s)`)

  const output = await runBatch({
    cases,
    concurrency: args.concurrency,
    allowPrivate: true,
    onCaseDone: (entry, index) => {
      const status = entry.status === 'ok' ? 'ok' : `failed (${entry.error?.code})`
      console.log(`[${index + 1}/${cases.length}] ${entry.id}: ${status}`)
    },
  })

  await writeFile(resolve(args.output), `${JSON.stringify(output, null, 2)}\n`, 'utf8')

  const ok = output.kits.filter((entry) => entry.status === 'ok').length
  console.log(`wrote ${args.output}: ${ok} ok, ${output.kits.length - ok} failed, ${Math.round((Date.now() - started) / 1000)}s`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
