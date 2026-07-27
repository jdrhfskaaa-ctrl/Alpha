// dist/ のビルド結果を単一HTMLファイルに統合するスクリプト
// 使い方: npm run build:single → dist/alphabet-gravity-game_<version>.html
import fs from 'node:fs'

const version = fs.readFileSync('src/game/types.ts', 'utf8').match(/APP_VERSION = '([^']+)'/)?.[1] ?? 'dev'
const assets = fs.readdirSync('dist/assets')
let html = fs.readFileSync('dist/index.html', 'utf8')
let js = fs.readFileSync('dist/assets/' + assets.find((f) => f.endsWith('.js')), 'utf8')
const css = fs.readFileSync('dist/assets/' + assets.find((f) => f.endsWith('.css')), 'utf8')

js = js.split('</script').join('<\\/script') // JS内文字列に閉じタグがあっても壊れないように
html = html.replace(/<script type="module"[^>]*><\/script>/, () => `<script type="module">\n${js}\n</script>`)
html = html.replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`)
html = html.replace(/<link rel="icon"[^>]*>/, '')

const out = `dist/alphabet-gravity-game_${version}.html`
fs.writeFileSync(out, html)
console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
