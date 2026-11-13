// Test-only runner; existing Firebase configuration and production rules are untouched.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
let runner=await readFile('scripts/run-invoice-workflow-tests.mjs','utf8')
runner=runner.replace("const root = fileURLToPath(new URL('../', import.meta.url))",`const root = ${JSON.stringify(resolve('.'))}`)
runner=runner.replace(/const command = [^\n]+/,"const command = 'node --test --test-concurrency=1 tests/security/invoice-ui-workflow.test.mjs tests/security/invoice-snapshot-compatibility.test.mjs'")
runner=runner.replace("'tests/security/results/latest.txt'","'tests/security/results/invoice-ui-workflow.txt'")
await import('data:text/javascript;base64,'+Buffer.from(runner).toString('base64'))
