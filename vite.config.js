import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: '/' for local dev; on GitHub Pages the deploy workflow sets BASE_PATH to '/<repo>/'
// so all runtime asset paths resolve under the project sub-path.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
