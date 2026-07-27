/**
 * ゲーム設定の永続化。
 * 単一HTMLをダウンロードして直接開く運用なので localStorage が使える。
 * 変更を購読できる軽量ストア（React 側は useSettings で購読）。
 */

export interface Settings {
  /** 視野角（度）。広いほど周辺が見えるが歪む。既定 78 */
  fov: number
  /** マウス感度。既定 1.0 */
  sensitivity: number
  /** 上下反転 */
  invertY: number // 0 or 1（真偽を数値で保持しJSON安定化）
  /** 重力再配向のスムージング（大きいほど機敏、小さいほど緩やかで酔いにくい）既定 12 */
  reorientSmooth: number
  /** 視点回転のスムージング（0=即時, 大きいほど滑らか）既定 0（無効） */
  lookSmooth: number
  /** マスター音量 0..1 */
  volume: number
  /** ミュート */
  muted: number // 0 or 1
}

export const DEFAULT_SETTINGS: Settings = {
  fov: 78,
  sensitivity: 1.0,
  invertY: 0,
  reorientSmooth: 12,
  lookSmooth: 0,
  volume: 0.85,
  muted: 0,
}

export const SETTINGS_RANGES = {
  fov: { min: 60, max: 100, step: 1 },
  sensitivity: { min: 0.3, max: 2.5, step: 0.05 },
  reorientSmooth: { min: 4, max: 20, step: 1 },
  lookSmooth: { min: 0, max: 0.4, step: 0.02 },
  volume: { min: 0, max: 1, step: 0.05 },
} as const

const KEY = 'alphagravity.settings.v1'

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let current: Settings = load()
const listeners = new Set<(s: Settings) => void>()

export function getSettings(): Settings {
  return current
}

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* localStorage 不可環境では揮発 */
  }
  listeners.forEach((l) => l(current))
}

export function resetSettings() {
  setSettings({ ...DEFAULT_SETTINGS })
}

export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
