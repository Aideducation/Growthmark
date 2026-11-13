// Same complete regression suite, with baseline writes and only the private override GET added.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
process.argv.push('--production-rules')
let runner=await readFile('scripts/run-security-tests.mjs','utf8')
runner=runner.replace("const root = fileURLToPath(new URL('../', import.meta.url))",`const root = ${JSON.stringify(resolve('.'))}`)
runner=runner.replace("if (productionRules) environment.GROWTHMARK_RULES_FILE = 'firestore.production.proposed.rules'", "if (productionRules) environment.GROWTHMARK_RULES_FILE = 'firestore.invoice-read-compatibility.proposed.rules'")
runner=runner.replace("'tests/security/results/latest.txt'","'tests/security/results/read-compatibility-regression.txt'")
runner=runner.replace("const child = spawn", "const baseCommand = command + ' tests/security/invoice-read-compatibility.test.mjs'\nconst child = spawn")
runner=runner.replace('[command]', '[baseCommand]')
await import('data:text/javascript;base64,'+Buffer.from(runner).toString('base64'))
