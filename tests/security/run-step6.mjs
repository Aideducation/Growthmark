// Disposable demo emulators only; production rules/configuration are never changed.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
process.env.GROWTHMARK_ALLOCATOR_IMPLEMENTATION='typescript'
let runner=await readFile('scripts/run-invoice-workflow-tests.mjs','utf8')
runner=runner.replace("const root = fileURLToPath(new URL('../', import.meta.url))",`const root = ${JSON.stringify(resolve('.'))}`)
runner=runner.replace(/const command = [^\n]+/,"const command = 'node --test --test-concurrency=1 tests/security/invoice-allocation-security.test.mjs tests/security/invoice-workflow-candidate.test.mjs tests/security/allocation-application.test.mjs tests/security/invoice-service-integration.test.mjs tests/security/invoice-ui-workflow.test.mjs tests/security/invoice-snapshot-compatibility.test.mjs'")
runner=runner.replace("'tests/security/results/latest.txt'","'tests/security/results/step6.txt'")
await import('data:text/javascript;base64,'+Buffer.from(runner).toString('base64'))
