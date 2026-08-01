import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { coachData } from './src/server/vite-plugin.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), coachData()],
})
