/**
 * タイトルロゴ「グラビティークイズ」。
 * 図形モードのピースと同じ発想で、カタカナ1文字を複数の多角形ピースに分解して構成する。
 * 読み込み時にピースが散らばった位置から所定の位置へ吸着してタイトルが完成する
 * ＝ゲームの図形モードそのものをロゴの動きにしている。
 */

export type Poly = [number, number][]

// ---- 各文字を 100×100 の升目でピース分解（y は下向き）----

const KU: Poly[] = [
  [[14, 12], [80, 12], [80, 26], [14, 26]], // 上の横棒
  [[66, 26], [79, 26], [39, 88], [26, 88]], // 右から左下への長い払い
  [[26, 26], [39, 26], [21, 60], [8, 60]], // 左の短い払い
]

const RA: Poly[] = [
  [[28, 10], [74, 10], [74, 23], [28, 23]], // 上の短い横棒
  [[10, 37], [86, 37], [86, 50], [10, 50]], // 長い横棒
  [[73, 50], [86, 50], [41, 88], [28, 88]], // 左下への払い
]

const HI: Poly[] = [
  [[24, 10], [38, 10], [38, 74], [24, 74]], // 左の縦棒
  [[38, 40], [80, 26], [80, 39], [38, 53]], // 右上へ伸びる横棒
  [[24, 72], [86, 60], [86, 73], [24, 85]], // 下の横棒
]

const TE: Poly[] = [
  [[22, 10], [76, 10], [76, 23], [22, 23]], // 上の短い横棒
  [[10, 35], [90, 35], [90, 48], [10, 48]], // 長い横棒
  [[52, 48], [65, 48], [48, 88], [35, 88]], // 中央の縦棒
]

const I: Poly[] = [
  [[70, 8], [82, 17], [24, 64], [12, 55]], // 右上から左下への払い
  [[44, 32], [57, 32], [57, 90], [44, 90]], // 縦棒
]

const SU: Poly[] = [
  [[14, 12], [84, 12], [84, 25], [14, 25]], // 上の横棒
  [[68, 25], [81, 25], [30, 74], [17, 74]], // 左下への払い
  [[40, 52], [51, 45], [88, 84], [77, 91]], // 右下への払い
]

const BAR: Poly[] = [
  [[8, 44], [50, 44], [50, 57], [8, 57]], // 長音符（2ピースに割って組み立て感を出す）
  [[50, 44], [92, 44], [92, 57], [50, 57]],
]

/** 濁点（2つの小さなピース） */
const DAKUTEN: Poly[] = [
  [[0, 0], [9, 3], [6, 18], [-3, 15]],
  [[15, 0], [24, 3], [21, 18], [12, 15]],
]

function transform(pieces: Poly[], s: number, dx: number, dy: number): Poly[] {
  return pieces.map((poly) => poly.map(([x, y]) => [x * s + dx, y * s + dy] as [number, number]))
}

/** 濁点つきの文字を作る（本体を少し縮めて右上に濁点を置く） */
function withDakuten(base: Poly[]): Poly[] {
  return [...transform(base, 0.85, 0, 8), ...transform(DAKUTEN, 0.85, 76, 2)]
}

export const GLYPHS: Record<string, Poly[]> = {
  グ: withDakuten(KU),
  ラ: RA,
  ビ: withDakuten(HI),
  テ: TE,
  ィ: transform(I, 0.62, 12, 36), // 小書き文字は一回り小さく下寄せ
  ー: BAR,
  ク: KU,
  イ: I,
  ズ: withDakuten(SU),
}

// ピースの色。ゲーム中の図形ピースと同じ砂岩系で、
// ランダムに散らすと雑然とするため左→右の連続したグラデーションにする。
const FILL_FROM = [0xf0, 0xb8, 0x8a]
const FILL_TO = [0xc4, 0x7f, 0x66]

function fillAt(t: number): string {
  const c = FILL_FROM.map((f, i) => Math.round(f + (FILL_TO[i] - f) * Math.min(1, Math.max(0, t))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/** 決定的な擬似乱数（render 中に Math.random を使わないため） */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

const LINE1 = ['グ', 'ラ', 'ビ', 'テ', 'ィ', 'ー']
const LINE2 = ['ク', 'イ', 'ズ']

const CELL = 100
const GAP = 6
const LINE_H = 118

const W1 = LINE1.length * CELL + (LINE1.length - 1) * GAP
const W2 = LINE2.length * CELL + (LINE2.length - 1) * GAP
const VB_W = W1
const VB_H = LINE_H + CELL

export const LAYOUT = { LINE1, LINE2, CELL, GAP, LINE_H, W1, W2, VB_W, VB_H }
export { fillAt, hash }
