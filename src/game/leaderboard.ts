/**
 * ランキング（リーダーボード）。localStorage に部門別で保存。
 * 部門キー = `${gametype}:${mode}:${variant}`
 * - solo: score = ソロスコア（点数、高いほど良い）
 * - endless: score = クリア数（高いほど良い）
 */

export type GameType = 'solo' | 'endless'

export interface Entry {
  name: string
  score: number
  detail: string
  date: number
}

const KEY = 'alphagravity.leaderboard.v1'
const NAME_KEY = 'alphagravity.playername.v1'
const MAX_PER_CAT = 10

type Store = Record<string, Entry[]>

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

function save(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* 揮発環境では保存しない */
  }
}

export function categoryKey(gametype: GameType, mode: string, variant: string): string {
  return `${gametype}:${mode}:${variant}`
}

const MODE_LABEL: Record<string, string> = {
  alphabet: 'アルファベット',
  image: '画像',
  shape: '図形',
}
const VARIANT_LABEL: Record<string, string> = {
  futsu: 'フツー',
  keiji: '刑事',
  canary: 'カナリー',
  easy: 'イージー',
  hard: 'ハード',
  random: 'ランダム',
}

export function modeLabel(mode: string): string {
  return MODE_LABEL[mode] ?? mode
}
export function variantLabel(v: string): string {
  return VARIANT_LABEL[v] ?? v
}
export function gametypeLabel(g: GameType): string {
  return g === 'solo' ? '1問チャレンジ' : 'エンドレス'
}

/** その部門の並び（降順・上位のみ） */
export function getBoard(key: string): Entry[] {
  const store = load()
  return (store[key] ?? []).slice().sort((a, b) => b.score - a.score).slice(0, MAX_PER_CAT)
}

/** スコアを登録。順位（1始まり）を返す。ランク外なら -1 */
export function addScore(key: string, entry: Entry): number {
  const store = load()
  const list = (store[key] ?? []).slice()
  list.push(entry)
  list.sort((a, b) => b.score - a.score)
  const trimmed = list.slice(0, MAX_PER_CAT)
  store[key] = trimmed
  save(store)
  const rank = trimmed.indexOf(entry)
  return rank >= 0 ? rank + 1 : -1
}

/** ランクインするか（登録前チェック） */
export function wouldRank(key: string, score: number): boolean {
  const board = getBoard(key)
  return board.length < MAX_PER_CAT || score > (board[board.length - 1]?.score ?? -1)
}

export function getPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
export function setPlayerName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    /* noop */
  }
}

/** 部門セレクタ用の選択肢 */
export function variantsFor(mode: string): string[] {
  if (mode === 'shape') return ['easy', 'hard', 'random']
  return ['futsu', 'keiji', 'canary']
}
