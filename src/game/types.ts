import type { BufferGeometry, Object3D } from 'three'
import type { MeshBVH } from 'three-mesh-bvh'

/** 画面内に表示するビルドバージョン。更新のたびに上げる */
export const APP_VERSION = 'v15'

export type GamePhase = 'START' | 'PLAYING' | 'REVEAL' | 'SUCCESS' | 'FAILED' | 'ENDLESS_OVER'

export interface SizeMode {
  id: 'futsu' | 'deka' | 'canary'
  label: string
  sub: string
  scale: number
}

export const SIZE_MODES: SizeMode[] = [
  { id: 'futsu', label: 'フツー', sub: '×1', scale: 1 },
  { id: 'deka', label: '刑事', sub: '×3 デカ', scale: 3 },
  { id: 'canary', label: 'カナリー', sub: '×30 かなりデカい', scale: 30 },
]

/** ゲームモード */
export type GameMode = 'alphabet' | 'image' | 'shape'

export type Difficulty = 'easy' | 'hard' | 'random'

/** 図形モードは難易度制・サイズ一律×3 */
export const SHAPE_SCALE = 3

/** ラウンドごとの土台の定義 */
export type Stage =
  | { kind: 'alphabet'; letter: string }
  | { kind: 'image'; url: string }
  | { kind: 'shape'; puzzleId: string; difficulty: Difficulty }

/** 複数土台対応の吸着サーフェス。object の matrixWorld が毎フレーム参照される */
export interface SurfaceEntry {
  id: number
  bvh: MeshBVH
  geometry: BufferGeometry
  object: Object3D
}

/** 文字メッシュの吸着計算に必要なデータ一式 */
export interface SurfaceData {
  bvh: MeshBVH
  geometry: BufferGeometry
  /** バウンディングスフィア半径（スポーン位置の算出に使用） */
  boundingRadius: number
}

/** ×1 のときの文字の高さ（ワールド単位）。すべての寸法の基準。 */
export const LETTER_SIZE = 10

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function randomLetter(): string {
  return LETTERS[Math.floor(Math.random() * LETTERS.length)]
}
