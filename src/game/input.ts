/**
 * キーボード入力のグローバル管理。
 * - keydown はフォーム (INPUT/TEXTAREA) にフォーカスがあるときは無視
 *   → 回答入力中に WASD でプレイヤーが動いてしまう干渉を防ぐ
 * - keyup は常に処理（キーが押しっぱなし判定のまま残るのを防ぐ）
 */
const pressed = new Set<string>()
let installed = false

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

export function installInputListeners() {
  if (installed) return
  installed = true
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return
    pressed.add(e.code)
  })
  window.addEventListener('keyup', (e) => {
    pressed.delete(e.code)
  })
  window.addEventListener('blur', () => pressed.clear())
}

export function isDown(code: string): boolean {
  return pressed.has(code)
}

export function clearInput() {
  pressed.clear()
}
