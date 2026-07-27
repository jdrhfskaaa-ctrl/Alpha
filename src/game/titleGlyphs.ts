/**
 * タイトルロゴ「グラビティークイズ」。
 * 図形モードのピースと同じ発想で、カタカナ1文字を複数の多角形ピースに分解して構成する。
 * 読み込み時にピースが散らばった位置から所定の位置へ吸着してタイトルが完成する
 * ＝ゲームの図形モードそのものをロゴの動きにしている。
 */

export type Poly = [number, number][]

// ---- 各文字を 100×100 の升目でピース分解（y は下向き）----

const KU: Poly[] = [
  [[12, 10], [82, 10], [82, 31], [12, 31]], // 上の横棒
  [[62, 31], [82, 31], [44, 90], [24, 90]], // 右から左下への長い払い
  [[22, 31], [42, 31], [22, 66], [4, 66]], // 左の短い払い
]

const RA: Poly[] = [
  [[26, 8], [76, 8], [76, 27], [26, 27]],
  [[8, 38], [88, 38], [88, 57], [8, 57]],
  [[68, 57], [88, 57], [44, 90], [24, 90]],
]

const HI: Poly[] = [
  [[20, 8], [41, 8], [41, 76], [20, 76]],
  [[41, 38], [82, 22], [82, 42], [41, 58]],
  [[20, 70], [88, 56], [88, 76], [20, 90]],
]

const TE: Poly[] = [
  [[20, 8], [78, 8], [78, 27], [20, 27]],
  [[6, 38], [92, 38], [92, 57], [6, 57]],
  [[48, 57], [68, 57], [46, 90], [26, 90]],
]

const I: Poly[] = [
  [[66, 4], [84, 18], [26, 66], [8, 52]],
  [[40, 30], [61, 30], [61, 92], [40, 92]],
]

const SU: Poly[] = [
  [[12, 10], [86, 10], [86, 29], [12, 29]],
  [[64, 29], [84, 29], [32, 76], [12, 76]],
  [[36, 50], [52, 40], [90, 82], [76, 94]],
]

const BAR: Poly[] = [
  [[6, 42], [50, 42], [50, 63], [6, 63]],
  [[50, 42], [94, 42], [94, 63], [50, 63]],
]

/** 濁点（2つの小さなピース） */
const DAKUTEN: Poly[] = [
  [[0, 0], [13, 4], [9, 24], [-4, 20]],
  [[19, 0], [32, 4], [28, 24], [15, 20]],
]

function transform(pieces: Poly[], s: number, dx: number, dy: number): Poly[] {
  return pieces.map((poly) => poly.map(([x, y]) => [x * s + dx, y * s + dy] as [number, number]))
}

/** 濁点つきの文字を作る（本体を少し縮めて右上に濁点を置く） */
function withDakuten(base: Poly[]): Poly[] {
  return [...transform(base, 0.92, 0, 6), ...transform(DAKUTEN, 0.7, 77, -2)]
}

export const GLYPHS: Record<string, Poly[]> = {
  グ: withDakuten(KU),
  ラ: RA,
  ビ: withDakuten(HI),
  テ: TE,
  ィ: transform(I, 0.6, 14, 34), // 小書き文字は一回り小さく下寄せ
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
