// Isolated complete invoice/security/provisioning suite; never targets production.
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
process.env.GROWTHMARK_INVOICE_RULES_FILE='firestore.release.rules'
let runner=await readFile('tests/security/run-step6.mjs','utf8')
runner=runner.replace("'tests/security/results/step6.txt'","'tests/security/results/release.txt'")
runner=runner.replace("tests/security/invoice-allocation-security.test.mjs", "tests/security/release-server.test.mjs tests/security/release-provisioning.test.mjs tests/security/invoice-allocation-security.test.mjs")
if(process.argv.includes('--provision-only'))runner=runner.replace(/node --test --test-concurrency=1 [^'\n]+/, 'node --test --test-concurrency=1 tests/security/release-provisioning.test.mjs tests/security/release-server.test.mjs')
// run-step6 reuses the same candidate rules as release; tests compare exact source separately.
runner=runner.replace("await readFile('scripts/run-invoice-workflow-tests.mjs','utf8')",`await readFile(${JSON.stringify(resolve('scripts/run-invoice-workflow-tests.mjs'))},'utf8')`)
await import('data:text/javascript;base64,'+Buffer.from(runner).toString('base64'))
