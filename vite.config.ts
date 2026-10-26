import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const headers = Object.fromEntries(readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split('\n').filter(line => line.startsWith('  ')).map(line => {
  const separator = line.indexOf(':')
  return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
}))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  preview: { headers },
})
