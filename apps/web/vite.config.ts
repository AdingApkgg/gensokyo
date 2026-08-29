import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './app/paraglide',
      emitTsDeclarations: true,
      strategy: ['url', 'cookie', 'baseLocale'],
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
    proxy: { '/api': 'http://localhost:3001' },
  },
})
