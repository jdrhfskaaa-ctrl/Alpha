import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' — GitHub Pages のプロジェクトサイト (username.github.io/repo/) でも
// パスが壊れないよう相対パスでビルドする
export default defineConfig({
  plugins: [react()],
  base: './',
})
