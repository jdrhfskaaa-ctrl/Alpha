/**
 * スコア計算。
 * コアピラー（探索して当てる）を「速く・迷わず・ミスなく」解いた人が
 * 報われるように設計する。
 */

export interface RoundStats {
  /** クリアタイム（秒） */
  timeSec: number
  /** ワープ回数（図形モードのみ発生。少ないほど良い＝効率的な探索） */
  warps: number
  /** ミス回数（アルファベット/画像=誤答、図形=接続失敗） */
  mistakes: number
  /** 歩行距離（ワールド単位。参考値。スコアには軽く反映） */
  walkDistance: number
}

export const EMPTY_STATS: RoundStats = { timeSec: 0, warps: 0, mistakes: 0, walkDistance: 0 }

/** バリアント（サイズ or 難易度）ごとの基礎点倍率。難しいほど高い */
export function variantMultiplier(mode: string, variant: string): number {
  if (mode === 'shape') return variant === 'hard' ? 2.4 : 1.5
  // アルファベット/画像はサイズ（futsu/keiji/canary）
  if (variant === 'canary') return 2.0
  if (variant === 'keiji') return 1.4
  return 1.0
}

const BASE = 10000
const TIME_W = 40 // 1秒あたり減点
const WARP_W = 60 // ワープ1回あたり減点
const MISS_W = 500 // ミス1回あたり減点
const WALK_W = 0.4 // 歩行距離あたり微減点

/** ソロ（1問）スコア。高いほど良い */
export function computeSoloScore(mode: string, variant: string, s: RoundStats): number {
  const mult = variantMultiplier(mode, variant)
  const raw =
    BASE * mult -
    s.timeSec * TIME_W -
    s.warps * WARP_W -
    s.mistakes * MISS_W -
    s.walkDistance * WALK_W
  return Math.max(0, Math.round(raw))
}

/**
 * エンドレススコア。到達問題数が主。合計残り時間などを従で加点し、
 * 同じ問題数なら効率的だった方が上に来るようにする。
 * score = cleared*100000 + timeBonus
 */
export function computeEndlessScore(cleared: number, leftoverSec: number): number {
  return cleared * 100000 + Math.round(leftoverSec * 100)
}

/** エンドレス表示用に問題数と補助値へ分解 */
export function decodeEndless(score: number): { cleared: number; bonus: number } {
  return { cleared: Math.floor(score / 100000), bonus: score % 100000 }
}

// ---------------- エンドレスモードの時間設定 ----------------

export interface EndlessTiming {
  /** 初期持ち時間（秒） */
  initial: number
  /** 1問クリアごとの追加時間（秒） */
  bonus: number
  /** 誤答時の減算（秒。図形モードは誤答概念なし=0） */
  penalty: number
}

/**
 * モード×バリアントごとのエンドレス時間。
 * 「アルファベット < 図形（easy < hard）」の難易度順を保つように、
 * 難しいほど1問に時間がかかる前提で初期・ボーナスを厚くしている。
 */
export function endlessTiming(mode: string, variant: string): EndlessTiming {
  if (mode === 'shape') {
    if (variant === 'hard') return { initial: 70, bonus: 22, penalty: 0 }
    if (variant === 'random') return { initial: 60, bonus: 18, penalty: 0 }
    return { initial: 50, bonus: 15, penalty: 0 }
  }
  // アルファベット（サイズが大きいほど読み取りに時間がかかる）
  if (variant === 'canary') return { initial: 45, bonus: 12, penalty: 5 }
  if (variant === 'keiji') return { initial: 35, bonus: 9, penalty: 5 }
  return { initial: 30, bonus: 8, penalty: 4 }
}
