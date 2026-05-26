import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Base path for GitHub Pages.
// - For project pages (https://<user>.github.io/work-instructions/): use '/work-instructions/'
// - For a custom domain at the root (e.g. work-instructions.rsmd365.com): change to '/'
const base = process.env.VITE_BASE_PATH ?? '/work-instructions/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
})
