import { defineConfig, loadEnv } from 'vite'
import { validateDeploymentEnvironment } from './scripts/build-vercel.mjs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig(({command,mode})=>{
  if(command==='build')validateDeploymentEnvironment(loadEnv(mode,process.cwd(),'VITE_'))
  return {plugins:[react(),tailwindcss()]}
})
