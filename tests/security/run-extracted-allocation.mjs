// Test-only launcher. Reuses existing emulator config and launcher without editing either.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
process.env.GROWTHMARK_ALLOCATOR_IMPLEMENTATION = 'typescript'
let runner = await readFile('scripts/run-invoice-workflow-tests.mjs', 'utf8')
runner = runner.replace("const root = fileURLToPath(new URL('../', import.meta.url))", `const root = ${JSON.stringify(resolve('.'))}`)
runner = runner.replace("'tests/security/results/latest.txt'", "'tests/security/results/extracted-allocation.txt'")
runner = runner.replace("tests/security/invoice-workflow-candidate.test.mjs'", "tests/security/invoice-workflow-candidate.test.mjs tests/security/allocation-application.test.mjs'")
await import('data:text/javascript;base64,' + Buffer.from(runner).toString('base64'))
