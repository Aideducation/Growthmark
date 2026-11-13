import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
process.argv.push('--production-rules')
let runner=await readFile('scripts/run-security-tests.mjs','utf8')
runner=runner.replace("const root = fileURLToPath(new URL('../', import.meta.url))",`const root = ${JSON.stringify(resolve('.'))}`)
runner=runner.replace("if (productionRules) environment.GROWTHMARK_RULES_FILE = 'firestore.production.proposed.rules'","if (productionRules) environment.GROWTHMARK_RULES_FILE = 'firestore.release.rules'")
runner=runner.replace("'tests/security/results/latest.txt'","'tests/security/results/release-regression.txt'")
await import('data:text/javascript;base64,'+Buffer.from(runner).toString('base64'))
