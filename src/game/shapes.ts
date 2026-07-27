/**
 * 図形モードの幾何エンジン。
 * Three.js に依存しない純粋な2Dロジックとして実装し、Node で単体テスト可能にする。
 *
 * 【モデル】
 * - パズル = 「完成形を隙間なく敷き詰めるスロット（多角形）の集合」
 * - ピース = クラス（合同形状）のプロトタイプ多角形。押し出して3Dスラブになる
 * - 接続判定 = マークされた2つの側面（辺）が、完成形レイアウト上で
 *   実際に接している辺のペアに対応し、かつピースがスロットに正確に
 *   はまる剛体変換（回転＋平行移動＋必要なら裏返し）が存在するか
 *
 * 【難易度の実現】
 * - イージー: 全スロットが同一クラス（合同ピース）→ どのピースをどこに
 *   どの順で繋いでも成立する = 自由度の高い判定が幾何から自然に生まれる
 * - ハード: 全スロットが固有クラス → 正しいピースを正しい面で繋ぐ
 *   組み合わせが厳密に1通りしかない
 */

// ---------------- 2D プリミティブ ----------------

export interface V2 {
  x: number
  y: number
}

/** 2D剛体変換（mir → 回転 → 平行移動 の順に適用） */
export interface T2 {
  rot: number
  mir: boolean
  tx: number
  ty: number
}

export const IDENTITY_T2: T2 = { rot: 0, mir: false, tx: 0, ty: 0 }

export function applyT2(t: T2, p: V2): V2 {
  const y0 = t.mir ? -p.y : p.y
  const c = Math.cos(t.rot)
  const s = Math.sin(t.rot)
  return { x: c * p.x - s * y0 + t.tx, y: s * p.x + c * y0 + t.ty }
}

function sub(a: V2, b: V2): V2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function dist(a: V2, b: V2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function angleOf(v: V2): number {
  return Math.atan2(v.y, v.x)
}

export function centroid(poly: V2[]): V2 {
  let x = 0
  let y = 0
  for (const p of poly) {
    x += p.x
    y += p.y
  }
  return { x: x / poly.length, y: y / poly.length }
}

/** 多角形の辺 i = points[i] → points[(i+1)%n] */
export function edgeOf(poly: V2[], i: number): [V2, V2] {
  return [poly[i], poly[(i + 1) % poly.length]]
}

/** CCW多角形の辺の外向き法線 */
export function edgeOutwardNormal(poly: V2[], i: number): V2 {
  const [p0, p1] = edgeOf(poly, i)
  const d = sub(p1, p0)
  const len = Math.hypot(d.x, d.y) || 1
  return { x: d.y / len, y: -d.x / len }
}

export function edgeLength(poly: V2[], i: number): number {
  const [p0, p1] = edgeOf(poly, i)
  return dist(p0, p1)
}

const EPS = 0.02

/** 2線分が（方向を問わず）一致するか */
function segCoincide(a0: V2, a1: V2, b0: V2, b1: V2): boolean {
  return (
    (dist(a0, b0) < EPS && dist(a1, b1) < EPS) ||
    (dist(a0, b1) < EPS && dist(a1, b0) < EPS)
  )
}

/** 頂点集合として2多角形が一致するか（順序・始点を問わない） */
export function polyMatch(a: V2[], b: V2[]): boolean {
  if (a.length !== b.length) return false
  const used = new Array(b.length).fill(false)
  for (const p of a) {
    let found = false
    for (let j = 0; j < b.length; j++) {
      if (!used[j] && dist(p, b[j]) < EPS) {
        used[j] = true
        found = true
        break
      }
    }
    if (!found) return false
  }
  return true
}

/**
 * poly の辺 edgeIdx を線分 (s0,s1) に一致させる剛体変換の候補を列挙する。
 * 端点の対応 2通り × 裏返し有無 2通り = 最大4候補。
 */
export function solveEdgeToSegment(poly: V2[], edgeIdx: number, s0: V2, s1: V2): T2[] {
  const [q0, q1] = edgeOf(poly, edgeIdx)
  const out: T2[] = []
  for (const mir of [false, true]) {
    const m0 = mir ? { x: q0.x, y: -q0.y } : q0
    const m1 = mir ? { x: q1.x, y: -q1.y } : q1
    for (const [t0, t1] of [
      [s0, s1],
      [s1, s0],
    ] as [V2, V2][]) {
      const rot = angleOf(sub(t1, t0)) - angleOf(sub(m1, m0))
      const c = Math.cos(rot)
      const s = Math.sin(rot)
      out.push({ rot, mir, tx: t0.x - (c * m0.x - s * m0.y), ty: t0.y - (s * m0.x + c * m0.y) })
    }
  }
  return out
}

// ---------------- パズル定義 ----------------

export interface SlotAuthored {
  classId: string
  /** 完成形レイアウト上の多角形（CCW） */
  poly: V2[]
}

export interface PuzzleDef {
  id: string
  name: string
  difficulty: 'easy' | 'hard'
  slots: SlotAuthored[]
  /** ダミーピース（別の図形のピース）: classId は必ずスロットに存在しないものにする */
  dummies: { classId: string; poly: V2[] }[]
}

export interface Slot {
  id: number
  classId: string
  poly: V2[]
}

export interface Adjacency {
  sa: number
  sb: number
  /** 共有辺（完成形レイアウト座標） */
  seg: [V2, V2]
}

export interface Puzzle {
  def: PuzzleDef
  slots: Slot[]
  adjacency: Adjacency[]
  /** classId → プロトタイプ多角形（重心を原点に平行移動済み） */
  protos: Map<string, V2[]>
  /** 実ピース数（スロット数） */
  realCount: number
}

function toProto(poly: V2[]): V2[] {
  const c = centroid(poly)
  return poly.map((p) => ({ x: p.x - c.x, y: p.y - c.y }))
}

export function buildPuzzle(def: PuzzleDef): Puzzle {
  const slots: Slot[] = def.slots.map((s, i) => ({ id: i, classId: s.classId, poly: s.poly }))

  const protos = new Map<string, V2[]>()
  for (const s of slots) {
    if (!protos.has(s.classId)) protos.set(s.classId, toProto(s.poly))
  }
  for (const d of def.dummies) {
    if (!protos.has(d.classId)) protos.set(d.classId, toProto(d.poly))
  }

  const adjacency: Adjacency[] = []
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const pa = slots[i].poly
      const pb = slots[j].poly
      for (let ei = 0; ei < pa.length; ei++) {
        for (let ej = 0; ej < pb.length; ej++) {
          const [a0, a1] = edgeOf(pa, ei)
          const [b0, b1] = edgeOf(pb, ej)
          if (segCoincide(a0, a1, b0, b1)) {
            adjacency.push({ sa: i, sb: j, seg: [a0, a1] })
          }
        }
      }
    }
  }

  return { def, slots, adjacency, protos, realCount: slots.length }
}

// ---------------- 接続判定 ----------------

export interface PieceInfo {
  id: number
  classId: string
}

export interface Placement {
  slotId: number
  t: T2
}

export type ConnectError =
  | 'BOTH_PLACED'
  | 'NEED_CLUSTER'
  | 'OUTER_FACE'
  | 'OCCUPIED'
  | 'WRONG_PIECE'
  | 'WRONG_FACE'
  | 'NO_FIRST_FIT'

export type ConnectResult =
  | {
      ok: true
      /** pieceId → 配置。anchorPieceId は現在のワールド位置を保ったまま組立フレームの基準になる */
      placements: { pieceId: number; placement: Placement }[]
      anchorPieceId: number
    }
  | { ok: false; error: ConnectError }

export interface Mark {
  pieceId: number
  edgeIdx: number
}

/**
 * マークされた2つの面（辺）で接続を試みる。
 * assigned: 既に組み込まれたピースの配置マップ
 */
export function tryConnect(
  puzzle: Puzzle,
  pieces: PieceInfo[],
  assigned: Map<number, Placement>,
  mA: Mark,
  mB: Mark,
): ConnectResult {
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const aPlaced = assigned.has(mA.pieceId)
  const bPlaced = assigned.has(mB.pieceId)

  if (aPlaced && bPlaced) return { ok: false, error: 'BOTH_PLACED' }

  if (!aPlaced && !bPlaced) {
    if (assigned.size > 0) return { ok: false, error: 'NEED_CLUSTER' }
    return firstConnect(puzzle, byId, mA, mB)
  }

  // A = 組立済み側 / B = 未接続側 に正規化
  const [pm, lm] = aPlaced ? [mA, mB] : [mB, mA]
  const placedPiece = byId.get(pm.pieceId)!
  const loosePiece = byId.get(lm.pieceId)!
  const pl = assigned.get(pm.pieceId)!

  // 組立済みピースのマーク辺 → 完成形レイアウト座標の線分へ
  const protoA = puzzle.protos.get(placedPiece.classId)!
  const [q0, q1] = edgeOf(protoA, pm.edgeIdx)
  const ea0 = applyT2(pl.t, q0)
  const ea1 = applyT2(pl.t, q1)

  // その線分に一致する隣接エントリを探す
  let partnerSlot = -1
  let seg: [V2, V2] | null = null
  for (const adj of puzzle.adjacency) {
    if ((adj.sa === pl.slotId || adj.sb === pl.slotId) && segCoincide(ea0, ea1, adj.seg[0], adj.seg[1])) {
      partnerSlot = adj.sa === pl.slotId ? adj.sb : adj.sa
      seg = adj.seg
      break
    }
  }
  if (partnerSlot < 0 || !seg) return { ok: false, error: 'OUTER_FACE' }

  for (const p of assigned.values()) {
    if (p.slotId === partnerSlot) return { ok: false, error: 'OCCUPIED' }
  }

  const slot = puzzle.slots[partnerSlot]
  if (slot.classId !== loosePiece.classId) return { ok: false, error: 'WRONG_PIECE' }

  // B のマーク辺を共有線分に一致させ、スロット多角形に正確にはまる変換を探す
  const protoB = puzzle.protos.get(loosePiece.classId)!
  if (Math.abs(edgeLength(protoB, lm.edgeIdx) - dist(seg[0], seg[1])) > EPS) {
    return { ok: false, error: 'WRONG_FACE' }
  }
  for (const cand of solveEdgeToSegment(protoB, lm.edgeIdx, seg[0], seg[1])) {
    const placed = protoB.map((p) => applyT2(cand, p))
    if (polyMatch(placed, slot.poly)) {
      return {
        ok: true,
        placements: [{ pieceId: loosePiece.id, placement: { slotId: partnerSlot, t: cand } }],
        anchorPieceId: pm.pieceId,
      }
    }
  }
  return { ok: false, error: 'WRONG_FACE' }
}

/** 最初の接続: どのスロットペアにもまだ誰も入っていない状態から2ピースを繋ぐ */
function firstConnect(
  puzzle: Puzzle,
  byId: Map<number, PieceInfo>,
  mA: Mark,
  mB: Mark,
): ConnectResult {
  const A = byId.get(mA.pieceId)!
  const B = byId.get(mB.pieceId)!
  const protoA = puzzle.protos.get(A.classId)!
  const protoB = puzzle.protos.get(B.classId)!

  for (const adj of puzzle.adjacency) {
    for (const [sX, sY, mX, mY, pX, pY] of [
      [adj.sa, adj.sb, mA, mB, protoA, protoB],
      [adj.sb, adj.sa, mA, mB, protoA, protoB],
      [adj.sa, adj.sb, mB, mA, protoB, protoA],
      [adj.sb, adj.sa, mB, mA, protoB, protoA],
    ] as [number, number, Mark, Mark, V2[], V2[]][]) {
      const slotX = puzzle.slots[sX]
      const slotY = puzzle.slots[sY]
      const pieceX = byId.get(mX.pieceId)!
      const pieceY = byId.get(mY.pieceId)!
      if (slotX.classId !== pieceX.classId || slotY.classId !== pieceY.classId) continue

      let tX: T2 | null = null
      for (const cand of solveEdgeToSegment(pX, mX.edgeIdx, adj.seg[0], adj.seg[1])) {
        if (polyMatch(pX.map((p) => applyT2(cand, p)), slotX.poly)) {
          tX = cand
          break
        }
      }
      if (!tX) continue

      let tY: T2 | null = null
      for (const cand of solveEdgeToSegment(pY, mY.edgeIdx, adj.seg[0], adj.seg[1])) {
        if (polyMatch(pY.map((p) => applyT2(cand, p)), slotY.poly)) {
          tY = cand
          break
        }
      }
      if (!tY) continue

      return {
        ok: true,
        placements: [
          { pieceId: mX.pieceId, placement: { slotId: sX, t: tX } },
          { pieceId: mY.pieceId, placement: { slotId: sY, t: tY } },
        ],
        anchorPieceId: mX.pieceId,
      }
    }
  }
  return { ok: false, error: 'NO_FIRST_FIT' }
}

// ---------------- パズルデータ ----------------

const SQ = 4 // 正方形パズルの半辺長

/** 正方形セル（中心cx,cy・一辺s）をCCWで返す */
function sqCell(cx: number, cy: number, s: number): V2[] {
  const h = s / 2
  return [
    { x: cx - h, y: cy - h },
    { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h },
    { x: cx - h, y: cy + h },
  ]
}

/** グリッド座標配列 → 合同な正方形スロット群（class 'usq'）。中心化して返す */
function squareGrid(cells: [number, number][], s = 5): SlotAuthored[] {
  const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length
  const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length
  return cells.map(([gx, gy]) => ({
    classId: 'usq',
    poly: sqCell((gx - cx) * s, (gy - cy) * s, s),
  }))
}

/** 軸に平行な矩形スロット（CCW）。x1>x0, y1>y0 を前提 */
function rect(x0: number, y0: number, x1: number, y1: number, classId: string): SlotAuthored {
  return {
    classId,
    poly: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  }
}

/** 三角形スロット（CCWで渡すこと） */
function tri(a: V2, b: V2, c: V2, classId: string): SlotAuthored {
  return { classId, poly: [a, b, c] }
}

/** 正三角形パズル用: 頂点3つをそのままスロット化（class 'etri'） */
function etriSlot(a: V2, b: V2, cc: V2): SlotAuthored {
  return { classId: 'etri', poly: [a, b, cc] }
}

const DUMMY_SETS: PuzzleDef['dummies'][] = [
  [
    { classId: 'dmA', poly: [{ x: 0, y: 0 }, { x: 5.5, y: 0 }, { x: 0, y: 5.5 }] },
    { classId: 'dmB', poly: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 5 }, { x: 0, y: 5 }] },
  ],
  [
    { classId: 'dmC', poly: [{ x: 0, y: 0 }, { x: 5.2, y: 0 }, { x: 2.6, y: 4.5 }] },
    { classId: 'dmD', poly: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] },
  ],
  [
    { classId: 'dmE', poly: [{ x: 0, y: 0 }, { x: 4.5, y: 0 }, { x: 2.2, y: 3.8 }] },
    { classId: 'dmF', poly: [{ x: 0, y: 0 }, { x: 3.5, y: 0 }, { x: 3.5, y: 3.5 }, { x: 0, y: 3.5 }] },
  ],
]

// 三角形パズルで使う定数
const TL = 5 // 正三角形の一辺
const TH = (TL * Math.sqrt(3)) / 2

export const PUZZLES: PuzzleDef[] = [
  {
    id: 'square4',
    name: '正方形',
    difficulty: 'easy',
    // 正方形を対角線で切った合同な直角二等辺三角形×4。
    // どの三角形をどの順で斜辺以外の面同士で繋いでも成立する（自由度B）
    slots: [
      { classId: 'tri', poly: [{ x: -SQ, y: -SQ }, { x: SQ, y: -SQ }, { x: 0, y: 0 }] },
      { classId: 'tri', poly: [{ x: SQ, y: -SQ }, { x: SQ, y: SQ }, { x: 0, y: 0 }] },
      { classId: 'tri', poly: [{ x: SQ, y: SQ }, { x: -SQ, y: SQ }, { x: 0, y: 0 }] },
      { classId: 'tri', poly: [{ x: -SQ, y: SQ }, { x: -SQ, y: -SQ }, { x: 0, y: 0 }] },
    ],
    dummies: [
      { classId: 'dm1', poly: [{ x: 0, y: 0 }, { x: 5.5, y: 0 }, { x: 0, y: 5.5 }] },
      { classId: 'dm2', poly: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 5 }, { x: 0, y: 5 }] },
    ],
  },
  {
    id: 'hex6',
    name: '六角形',
    difficulty: 'easy',
    // 正六角形 = 合同な正三角形×6（自由度B）
    slots: Array.from({ length: 6 }, (_, k) => {
      const a0 = (k * Math.PI) / 3
      const a1 = ((k + 1) * Math.PI) / 3
      return {
        classId: 'etri',
        poly: [
          { x: 0, y: 0 },
          { x: 4 * Math.cos(a0), y: 4 * Math.sin(a0) },
          { x: 4 * Math.cos(a1), y: 4 * Math.sin(a1) },
        ],
      }
    }),
    dummies: [
      { classId: 'dm1', poly: [{ x: 0, y: 0 }, { x: 5.2, y: 0 }, { x: 2.6, y: 4.5 }] },
      { classId: 'dm2', poly: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }] },
    ],
  },
  {
    id: 'rocket5',
    name: 'ロケット',
    difficulty: 'hard',
    // 全ピースが異なる形。正しいピースを正しい面で繋ぐ組み合わせは1通り（厳密A）
    slots: [
      // 機体下部 3×3
      {
        classId: 'lrect',
        poly: [{ x: -1.5, y: -3 }, { x: 1.5, y: -3 }, { x: 1.5, y: 0 }, { x: -1.5, y: 0 }],
      },
      // 機体上部 3×2
      {
        classId: 'urect',
        poly: [{ x: -1.5, y: 0 }, { x: 1.5, y: 0 }, { x: 1.5, y: 2 }, { x: -1.5, y: 2 }],
      },
      // ノーズコーン
      { classId: 'nose', poly: [{ x: -1.5, y: 2 }, { x: 1.5, y: 2 }, { x: 0, y: 4.5 }] },
      // 右フィン
      { classId: 'rfin', poly: [{ x: 1.5, y: -3 }, { x: 3.5, y: -3 }, { x: 1.5, y: 0 }] },
      // 左フィン（右フィンの鏡像だが独立クラス → 左右を取り違えると不正解）
      { classId: 'lfin', poly: [{ x: -1.5, y: -3 }, { x: -1.5, y: 0 }, { x: -3.5, y: -3 }] },
    ],
    dummies: [
      { classId: 'dm1', poly: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 3 }] },
      { classId: 'dm2', poly: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }] },
    ],
  },

  // ============ 追加 EASY（合同ピース・自由に組める） ============
  {
    id: 'e_plus5',
    name: 'プラス',
    difficulty: 'easy',
    slots: squareGrid([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]),
    dummies: DUMMY_SETS[0],
  },
  {
    id: 'e_rect6',
    name: '長方形',
    difficulty: 'easy',
    slots: squareGrid([[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]),
    dummies: DUMMY_SETS[1],
  },
  {
    id: 'e_square9',
    name: '大きな正方形',
    difficulty: 'easy',
    slots: squareGrid([
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [0, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ]),
    dummies: DUMMY_SETS[2],
  },
  {
    id: 'e_L5',
    name: 'L字',
    difficulty: 'easy',
    slots: squareGrid([[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]]),
    dummies: DUMMY_SETS[0],
  },
  {
    id: 'e_T5',
    name: 'T字',
    difficulty: 'easy',
    slots: squareGrid([[-1, 1], [0, 1], [1, 1], [0, 0], [0, -1]]),
    dummies: DUMMY_SETS[1],
  },
  {
    id: 'e_stair6',
    name: '階段',
    difficulty: 'easy',
    slots: squareGrid([[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]]),
    dummies: DUMMY_SETS[2],
  },
  {
    id: 'e_rect8',
    name: 'レンガ',
    difficulty: 'easy',
    slots: squareGrid([
      [0, 0], [1, 0], [0, 1], [1, 1],
      [0, 2], [1, 2], [0, 3], [1, 3],
    ]),
    dummies: DUMMY_SETS[0],
  },
  {
    id: 'e_rhombus2',
    name: 'ひし形',
    difficulty: 'easy',
    slots: [
      etriSlot({ x: 0, y: 0 }, { x: TL, y: 0 }, { x: TL / 2, y: TH }),
      etriSlot({ x: TL, y: 0 }, { x: (3 * TL) / 2, y: TH }, { x: TL / 2, y: TH }),
    ],
    dummies: DUMMY_SETS[1],
  },
  {
    id: 'e_trapezoid3',
    name: '台形',
    difficulty: 'easy',
    slots: [
      etriSlot({ x: 0, y: 0 }, { x: TL, y: 0 }, { x: TL / 2, y: TH }),
      etriSlot({ x: TL, y: 0 }, { x: (3 * TL) / 2, y: TH }, { x: TL / 2, y: TH }),
      etriSlot({ x: TL, y: 0 }, { x: 2 * TL, y: 0 }, { x: (3 * TL) / 2, y: TH }),
    ],
    dummies: DUMMY_SETS[2],
  },
  {
    id: 'e_bigtri4',
    name: '三角形',
    difficulty: 'easy',
    slots: [
      etriSlot({ x: 0, y: 0 }, { x: TL, y: 0 }, { x: TL / 2, y: TH }),
      etriSlot({ x: TL, y: 0 }, { x: 2 * TL, y: 0 }, { x: (3 * TL) / 2, y: TH }),
      etriSlot({ x: TL / 2, y: TH }, { x: (3 * TL) / 2, y: TH }, { x: TL, y: 2 * TH }),
      etriSlot({ x: TL, y: 0 }, { x: (3 * TL) / 2, y: TH }, { x: TL / 2, y: TH }),
    ],
    dummies: DUMMY_SETS[0],
  },

  // ============ 追加 HARD（固有ピース・まっすぐな辺・同形は最大2つ） ============
  {
    id: 'h_house',
    name: '家',
    difficulty: 'hard',
    // 下部胴・上部胴（高さ違い）・屋根。すべて異なる形
    slots: [
      rect(0, 0, 6, 3, 'hb'),
      rect(0, 3, 6, 5, 'hu'),
      tri({ x: 0, y: 5 }, { x: 6, y: 5 }, { x: 3, y: 7.5 }, 'hr'),
    ],
    dummies: DUMMY_SETS[0],
  },
  {
    id: 'h_pencil',
    name: 'えんぴつ',
    difficulty: 'hard',
    // 消しゴム・胴×2（同形）・削り先。同形は胴の2つのみ
    slots: [
      rect(0, 0, 2, 1, 'pe'),
      rect(0, 1, 2, 3, 'pb'),
      rect(0, 3, 2, 5, 'pb'),
      tri({ x: 0, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 6.5 }, 'pt'),
    ],
    dummies: DUMMY_SETS[1],
  },
  {
    id: 'h_tower',
    name: 'タワー',
    difficulty: 'hard',
    // 高さの異なる3段 + 尖塔。すべて異なる形
    slots: [
      rect(0, 0, 3, 1.5, 't1'),
      rect(0, 1.5, 3, 4, 't2'),
      rect(0, 4, 3, 5, 't3'),
      tri({ x: 0, y: 5 }, { x: 3, y: 5 }, { x: 1.5, y: 7 }, 't4'),
    ],
    dummies: DUMMY_SETS[2],
  },
  {
    id: 'h_gem',
    name: '宝石',
    difficulty: 'hard',
    // 上下の三角（向き違い）+ 中央帯。すべて異なる形
    slots: [
      tri({ x: 0, y: 2 }, { x: 1.5, y: 0 }, { x: 3, y: 2 }, 'gbot'),
      rect(0, 2, 3, 4, 'gm'),
      tri({ x: 0, y: 4 }, { x: 3, y: 4 }, { x: 1.5, y: 6 }, 'gtop'),
    ],
    dummies: DUMMY_SETS[0],
  },
  {
    id: 'h_envelope',
    name: '手紙',
    difficulty: 'hard',
    // 本体2段（同形）+ フタ。同形は本体2つのみ
    slots: [
      rect(0, 0, 6, 1.5, 'eb'),
      rect(0, 1.5, 6, 3, 'eb'),
      tri({ x: 0, y: 3 }, { x: 6, y: 3 }, { x: 3, y: 5 }, 'ef'),
    ],
    dummies: DUMMY_SETS[1],
  },
  {
    id: 'h_mountain',
    name: '山',
    difficulty: 'hard',
    // 地面・山肌（台形）・山頂。すべて異なる形
    slots: [
      rect(0, 0, 6, 1, 'mg'),
      {
        classId: 'ms',
        poly: [
          { x: 0, y: 1 },
          { x: 6, y: 1 },
          { x: 4.5, y: 3.5 },
          { x: 1.5, y: 3.5 },
        ],
      },
      tri({ x: 1.5, y: 3.5 }, { x: 4.5, y: 3.5 }, { x: 3, y: 5.5 }, 'mp'),
    ],
    dummies: DUMMY_SETS[2],
  },
  {
    id: 'h_arrow',
    name: '矢印',
    difficulty: 'hard',
    // 尾・軸（幅違い）・矢じり。すべて異なる形
    slots: [
      rect(0, 0, 1.5, 2, 'aL'),
      rect(1.5, 0, 4, 2, 'aR'),
      tri({ x: 4, y: 0 }, { x: 6.5, y: 1 }, { x: 4, y: 2 }, 'ah'),
    ],
    dummies: DUMMY_SETS[0],
  },
  {
    id: 'h_robot',
    name: 'ロボット',
    difficulty: 'hard',
    // 足・胴・頭（高さ違い）+ アンテナ。すべて異なる形
    slots: [
      rect(0, 0, 4, 1, 'rf'),
      rect(0, 1, 4, 3.5, 'rb'),
      rect(0, 3.5, 4, 5, 'rh'),
      tri({ x: 0, y: 5 }, { x: 4, y: 5 }, { x: 2, y: 6.2 }, 'ra'),
    ],
    dummies: DUMMY_SETS[1],
  },
  {
    id: 'h_ship',
    name: '船',
    difficulty: 'hard',
    // 船体（台形）・甲板・帆。すべて異なる形
    slots: [
      {
        classId: 'sh',
        poly: [
          { x: 1, y: 0 },
          { x: 5, y: 0 },
          { x: 6, y: 1.5 },
          { x: 0, y: 1.5 },
        ],
      },
      rect(0, 1.5, 6, 2, 'sk'),
      tri({ x: 0, y: 2 }, { x: 6, y: 2 }, { x: 3, y: 4.5 }, 'ss'),
    ],
    dummies: DUMMY_SETS[2],
  },
]

export function pickPuzzle(difficulty: 'easy' | 'hard', rand: () => number): PuzzleDef {
  const list = PUZZLES.filter((p) => p.difficulty === difficulty)
  return list[Math.floor(rand() * list.length)]
}

/** 全図形からランダムに1問（ランダムモード用） */
export function pickAnyPuzzle(rand: () => number): PuzzleDef {
  return PUZZLES[Math.floor(rand() * PUZZLES.length)]
}
