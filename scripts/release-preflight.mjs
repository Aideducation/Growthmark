// Read-only Git/security review plus an explicit safe-path manifest. Never stages or publishes.
import {execFileSync} from 'node:child_process'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {loadEnv} from 'vite'
import {validateDeploymentEnvironment} from './build-vercel.mjs'
const run=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})
const manifest='docs/release-git-files.txt'
const files=[...new Set([...run(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean),manifest])].sort()
const privatePath=/(^|\/)(?:\.env(?:\..+)?|\.dev\.vars.*|\.aws|\.codex|\.agents|\.release-private|backups?|node_modules|dist|auth_export|firestore_export|firebase-export[^/]*|credentials\.json|.*(?:service[-_]?account|firebase-adminsdk).*\.json)(\/|$)|\.(?:pem|key|p12|pfx|bak|backup)$/i
const sensitive=/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?:\s|\\n|\\r)+[A-Za-z0-9+/]{32}/
try{
  validateDeploymentEnvironment(loadEnv('production',process.cwd(),'VITE_'))
  for(const file of files){
    if(file!=='.env.example'&&privatePath.test(file))throw new Error('Sensitive/local path detected: '+file)
    if(file===manifest)continue
    const data=await readFile(file);if(data.includes(0))continue
    if(sensitive.test(data.toString()))throw new Error('Possible private key detected in '+file)
  }
  for(const file of ['.env.local','.dev.vars','.release-private/review.json','backups/example.bak','tests/security/results/example.json','firebase-export-example/auth_export/accounts.json','dist/index.html']){
    try{run(['check-ignore','--quiet',file])}catch{throw new Error('Private/generated path is not ignored: '+file)}
  }
  await writeFile(manifest,files.join('\n')+'\n')
  const staged=run(['diff','--cached','--name-only','-z']).split('\0').filter(Boolean)
  for(const file of staged)if(!files.includes(file)||file!=='.env.example'&&privatePath.test(file))throw new Error('Unexpected staged path: '+file)
  await mkdir('tests/security/results',{recursive:true})
  const report={project:'growthmark-c0e9c',safeFileCount:files.length,stagedFiles:staged,manifest,privatePathsIgnored:true,privateKeyScan:'passed',productionEnvironmentGuard:'passed'}
  await writeFile('tests/security/results/release-preflight.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(error){console.error(error.message);process.exitCode=1}
