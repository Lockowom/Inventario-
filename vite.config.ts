import fs from 'node:fs'
import process from 'node:process'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const releasePolicy = JSON.parse(fs.readFileSync(new URL('./release-policy.json', import.meta.url), 'utf8')) as {
  productionLocked: boolean
  qaSupabaseProjectRef: string
}

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const readEnv = (name: string) => process.env[name] || fileEnv[name] || ''
  const releaseEnvironment = readEnv('VITE_RELEASE_ENV').trim().toLowerCase()
  const releaseChannel = readEnv('VITE_RELEASE_CHANNEL').trim().toLowerCase()
  const supabaseUrl = readEnv('VITE_SUPABASE_URL')
  const supabaseAnonKey = readEnv('VITE_SUPABASE_ANON_KEY')

  if (releasePolicy.productionLocked && (releaseEnvironment === 'production' || releaseChannel === 'production')) {
    throw new Error('PRODUCTION RELEASE BLOCKED: release-policy.json keeps productionLocked=true.')
  }

  const isLocalBackend = supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')
  const isQaBackend = supabaseUrl.includes(`${releasePolicy.qaSupabaseProjectRef}.supabase.co`)
  if (releasePolicy.productionLocked && supabaseUrl && !isLocalBackend && !isQaBackend) {
    throw new Error('REMOTE BACKEND BLOCKED: F10A accepts only local Supabase or INVEN3-QA.')
  }

  if (releaseEnvironment === 'qa') {
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('QA release build requires Supabase URL and public anon/publishable key.')
    if (!supabaseUrl.includes(`${releasePolicy.qaSupabaseProjectRef}.supabase.co`)) {
      throw new Error('QA release build refuses a Supabase URL outside INVEN3-QA.')
    }
  }

  return {
    plugins: [react()],
    build: { outDir: 'dist', sourcemap: true },
    test: { environment: 'jsdom', globals: true, setupFiles: './vitest.setup.ts', exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**', 'tests/visual/**'] },
  }
})
