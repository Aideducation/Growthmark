import { spawn } from 'node:child_process'
import { existsSync, readdirSync, mkdirSync, createWriteStream } from 'node:fs'
import { resolve, delimiter, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const startOnly = process.argv.includes('--start')
const projectId = startOnly ? 'demo-growthmark-security' : 'demo-growthmark-security-tests'
const environment = { ...process.env }
// Opt-in proposal testing affects only the isolated test emulator, never development or live rules.
delete environment.GROWTHMARK_RULES_FILE
if (!startOnly && process.argv.includes('--agency-invoice')) environment.GROWTHMARK_RULES_FILE = 'firestore.agency-invoice.proposed.rules'
const inheritedPath = Object.entries(environment).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key]
environment.PATH = dirname(process.execPath) + delimiter + inheritedPath
// Isolate the CLI from any configured real project or application credentials.
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'FIREBASE_CONFIG']) delete environment[key]
environment.GCLOUD_PROJECT = projectId
environment.GOOGLE_CLOUD_PROJECT = projectId
environment.FIREBASE_CLI_DISABLE_MOTD = 'true'
environment.FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true'
environment.CI = 'true'
environment.FIREBASE_EMULATORS_PATH = resolve(root, '.cache/firebase/emulators')
const portableRoot = resolve(root, '.tools/java21')
if (existsSync(portableRoot)) {
  const runtime = readdirSync(portableRoot).find(name => existsSync(resolve(portableRoot, name, 'bin/java.exe')))
  if (runtime) {
    environment.JAVA_HOME = resolve(portableRoot, runtime)
    environment.PATH = resolve(environment.JAVA_HOME, 'bin') + delimiter + (environment.PATH ?? '')
  }
}
mkdirSync(resolve(root, 'tests/security/results'), { recursive: true })
const log = createWriteStream(resolve(root, startOnly ? 'tests/security/results/development-emulators.txt' : 'tests/security/results/latest.txt'))
const extra = process.argv.includes('--agency-invoice') ? ' tests/security/advanced-invoice-calculations.test.mjs tests/security/agency-invoice-security.test.mjs' : ''
const command = 'node --test --test-concurrency=1 tests/security/firestore.test.mjs tests/security/auth-registration.test.mjs tests/security/phase2-services.test.mjs tests/security/module-services.test.mjs tests/security/document-export.test.mjs' + extra
const child = spawn(process.execPath, [
  resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js'),
  startOnly ? 'emulators:start' : 'emulators:exec', '--project', projectId,
  '--config', startOnly ? 'firebase.emulator.json' : 'firebase.tests.json', '--only', 'auth,firestore', ...(startOnly ? [] : [command]),
], { cwd: root, env: environment, stdio: ['inherit', 'pipe', 'pipe'] })
for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  stream.on('data', chunk => { output.write(chunk); log.write(chunk) })
}
child.on('error', error => { console.error(error); log.end(); process.exitCode = 1 })
child.on('close', code => { log.end(); process.exitCode = code ?? 1 })
