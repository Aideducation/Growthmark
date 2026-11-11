import { loadEnv } from 'vite'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateDeploymentEnvironment(env) {
  if (env.VITE_USE_FIREBASE_EMULATORS !== 'false') throw new Error('Deployment blocked: set VITE_USE_FIREBASE_EMULATORS=false explicitly in Vercel.')
  const required = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']
  for (const suffix of required) {
    const key = `VITE_FIREBASE_${suffix}`, value = env[key]?.trim()
    if (!value || /^(your-|replace|placeholder)/i.test(value)) throw new Error(`Deployment blocked: ${key} is missing or still a placeholder.`)
    if (value !== env[key]) throw new Error(`Deployment blocked: remove surrounding whitespace from ${key}.`)
  }
  // Validate the approved destination; never substitute a different project ID.
  if (env.VITE_FIREBASE_PROJECT_ID !== 'growthmark-c0e9c') throw new Error('Deployment blocked: expected VITE_FIREBASE_PROJECT_ID=growthmark-c0e9c.')
  if (/localhost|127\.0\.0\.1|https?:|\//i.test(env.VITE_FIREBASE_AUTH_DOMAIN)) throw new Error('Deployment blocked: use the Firebase Auth hostname, not localhost or a URL.')
  for (const [key, value] of Object.entries(env)) {
    if (/PRIVATE_KEY|SERVICE_ACCOUNT|CLIENT_SECRET|PASSWORD|REFRESH_TOKEN/i.test(key) || /-----BEGIN .*PRIVATE KEY-----|"type"\s*:\s*"service_account"/.test(value)) throw new Error(`Deployment blocked: ${key} appears to contain private credentials. VITE variables are public.`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const env = loadEnv('production', process.cwd(), 'VITE_')
    validateDeploymentEnvironment(env)
    console.log('Deployment configuration verified: real Firebase, growthmark-c0e9c. No emulator connections selected.')
    if (!process.argv.includes('--check')) {
      for (const args of [[resolve('node_modules/typescript/bin/tsc'), '-b'], [resolve('node_modules/vite/bin/vite.js'), 'build']]) {
        const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env, VITE_USE_FIREBASE_EMULATORS: 'false' } })
        if (result.error) throw result.error
        if (result.status !== 0) process.exit(result.status ?? 1)
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
