// Separate, local-only preview. No imports, exports, resets, credentials or live project.
import { spawn } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { resolve, delimiter, dirname } from 'node:path'
const environment = { ...process.env, GCLOUD_PROJECT: 'demo-growthmark-invoice-preview', GOOGLE_CLOUD_PROJECT: 'demo-growthmark-invoice-preview', CI: 'true', FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true', FIREBASE_EMULATORS_PATH: resolve('.cache/firebase/emulators') }
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'FIREBASE_CONFIG']) delete environment[key]
const pathEntry = Object.entries(environment).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key]
environment.PATH = dirname(process.execPath) + delimiter + pathEntry
if (existsSync('.tools/java21')) {
  const runtime = readdirSync('.tools/java21').find(name => existsSync(resolve('.tools/java21', name, 'bin/java.exe')))
  if (runtime) { environment.JAVA_HOME = resolve('.tools/java21', runtime); environment.PATH = resolve(environment.JAVA_HOME, 'bin') + delimiter + environment.PATH }
}
const child = spawn(process.execPath, [resolve('node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:start', '--project', 'demo-growthmark-invoice-preview', '--config', 'firebase.invoice-preview.json', '--only', 'auth,firestore'], { env: environment, stdio: 'inherit' })
child.on('exit', code => { process.exitCode = code ?? 1 })
