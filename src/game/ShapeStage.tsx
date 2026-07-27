import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Raycaster,
  Shape,
  Vector2,
  Vector3,
} from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import {
  buildPuzzle,
  edgeOf,
  edgeOutwardNormal,
  tryConnect,
  PUZZLES,
  type Mark,
  type Placement,
  type T2,
  type V2,
} from './shapes'
import type { RoundStats } from './score'
import { warp as audioWarp } from './audio'
import { SHAPE_SCALE, type SurfaceEntry } from './types'
import type { PlayerCommand } from './Player'

const DEPTH = 1.4 // ピースの厚み（基準単位）
const SCATTER_RADIUS = 11 // 散乱シェル半径（基準単位）
const ANIM_DURATION = 1.0

export type ShapeMessage =
  | 'MARKED'
  | 'REMARKED'
  | 'CONNECTED'
  | 'COMPLETE'
  | 'TOP_FACE'
  | 'SAME_PIECE'
  | 'BOTH_PLACED'
  | 'NEED_CLUSTER'
  | 'OUTER_FACE'
  | 'OCCUPIED'
  | 'WRONG_PIECE'
  | 'WRONG_FACE'
  | 'NO_FIRST_FIT'
  | 'MARK_CLEARED'
  | 'ANIMATING'

export interface ShapeHud {
  placed: number
  total: number
  markedDesc: string | null
}

interface PieceState {
  id: number
  classId: string
  isDummy: boolean
  color: string
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 2D配置変換 → 3D行列（mir は面内軸まわりの180°回転 = スラブの裏返しとして実現） */
function t2ToMatrix(t: T2, out: Matrix4): Matrix4 {
  const rotZ = new Matrix4().makeRotationZ(t.rot)
  out.makeTranslation(t.tx * SHAPE_SCALE, t.ty * SHAPE_SCALE, 0)
  out.multiply(rotZ)
  if (t.mir) out.multiply(new Matrix4().makeRotationX(Math.PI))
  return out
}

const PIECE_COLORS = ['#d8956b', '#c9a86a', '#b98a8a', '#a8977d', '#caa27b', '#bb9d90', '#d0a468']

/** 接続成功時に弾ける小さな光の粒。約0.7秒で消える */
function ConnectBurst({ pos, onDone }: { pos: [number, number, number]; onDone: () => void }) {
  const COUNT = 40
  const geo = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(COUNT * 3), 3))
    return g
  }, [])
  const stateRef = useRef<{ vel: Float32Array; t: number } | null>(null)
  const matRef = useRef<{ opacity: number } | null>(null)
  useEffect(() => {
    const vel = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      const dir = new Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize()
      const sp = (2 + Math.random() * 6) * SHAPE_SCALE
      vel[i * 3] = dir.x * sp
      vel[i * 3 + 1] = dir.y * sp
      vel[i * 3 + 2] = dir.z * sp
    }
    stateRef.current = { vel, t: 0 }
  }, [])
  useEffect(() => () => geo.dispose(), [geo])

  useFrame((_, delta) => {
    const st = stateRef.current
    if (!st) return
    const dt = Math.min(delta, 1 / 30)
    const LIFE = 0.7
    st.t += dt / LIFE
    if (st.t >= 1) {
      onDone()
      return
    }
    const r = 1 - Math.pow(1 - st.t, 2)
    const posAttr = geo.getAttribute('position') as Float32BufferAttribute
    for (let i = 0; i < COUNT; i++) {
      posAttr.setXYZ(i, st.vel[i * 3] * r, st.vel[i * 3 + 1] * r, st.vel[i * 3 + 2] * r)
    }
    posAttr.needsUpdate = true
    if (matRef.current) matRef.current.opacity = 0.9 * (1 - st.t)
  })

  return (
    <points geometry={geo} position={pos}>
      <pointsMaterial
        ref={matRef}
        size={0.6 * SHAPE_SCALE}
        color="#7ef2d0"
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={AdditiveBlending}
        fog={false}
      />
    </points>
  )
}

/**
 * 指定中の側面を強調表示するためのクアッドジオメトリ。
 * proto（重心中心の2D多角形）の辺 edgeIdx を厚み方向(z)に押し出した
 * 側面矩形を、押し出しジオメトリと同じ SHAPE_SCALE 空間で作る。
 * 面から少しだけ外向きにオフセットして Z ファイティングを避ける。
 */
function buildFaceHighlightGeometry(proto: V2[], edgeIdx: number): BufferGeometry {
  const [p0, p1] = edgeOf(proto, edgeIdx)
  const en = edgeOutwardNormal(proto, edgeIdx)
  const off = 0.03 // 外向きオフセット（基準単位）
  const hz = (DEPTH / 2) * 1.02
  const S = SHAPE_SCALE
  const ox = en.x * off
  const oy = en.y * off
  // 4隅: (p0,-z)(p1,-z)(p1,+z)(p0,+z)
  const corners = [
    [(p0.x + ox) * S, (p0.y + oy) * S, -hz * S],
    [(p1.x + ox) * S, (p1.y + oy) * S, -hz * S],
    [(p1.x + ox) * S, (p1.y + oy) * S, hz * S],
    [(p0.x + ox) * S, (p0.y + oy) * S, hz * S],
  ]
  const verts = [
    ...corners[0], ...corners[1], ...corners[2],
    ...corners[0], ...corners[2], ...corners[3],
  ]
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(verts, 3))
  return geo
}

/** 指定中の側面をハイライトする板（親グループの子として置くと変形に追従する） */
function FaceHighlight({ proto, edgeIdx }: { proto: V2[]; edgeIdx: number }) {
  const geo = useMemo(() => buildFaceHighlightGeometry(proto, edgeIdx), [proto, edgeIdx])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <mesh geometry={geo}>
      <meshBasicMaterial
        color="#7ef2d0"
        transparent
        opacity={0.55}
        side={DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

interface ShapeStageProps {
  puzzleId: string
  runId: number
  active: boolean
  onSurfaces: (entries: SurfaceEntry[], probeRadius: number) => void
  commandRef: React.RefObject<PlayerCommand | null>
  statsRef?: React.RefObject<RoundStats | null>
  onMessage: (msg: ShapeMessage) => void
  onHud: (hud: ShapeHud) => void
  /** 完成時に完成形の中心・大きさを通知（正解発表カメラ用） */
  onComplete: (info: { center: [number, number, number]; radius: number }) => void
}

/**
 * 図形モードのステージ。
 * - パズルの実ピース＋ダミーピースを空間に散乱させて生成
 * - クリック: レティクル方向にレイキャストし、ヒットしたピース表面へワープ
 * - F: 立っている側面をマーク。2つ目のマークで接続判定（shapes.ts の tryConnect）
 * - 成功時: 未接続ピースがアニメーションで飛んでいき、面同士がくっつく
 * - X: マーク解除
 */
export function ShapeStage({
  puzzleId,
  runId,
  active,
  onSurfaces,
  commandRef,
  statsRef,
  onMessage,
  onHud,
  onComplete,
}: ShapeStageProps) {
  const { camera, gl, scene } = useThree()

  const puzzle = useMemo(() => buildPuzzle(PUZZLES.find((p) => p.id === puzzleId)!), [puzzleId])

  // ---- ピース定義（実ピース = スロットごとに1つ + ダミー） ----
  const pieces = useMemo<PieceState[]>(() => {
    const list: PieceState[] = []
    puzzle.slots.forEach((s, i) => {
      list.push({ id: i, classId: s.classId, isDummy: false, color: PIECE_COLORS[i % PIECE_COLORS.length] })
    })
    puzzle.def.dummies.forEach((d, i) => {
      list.push({
        id: 100 + i,
        classId: d.classId,
        isDummy: true,
        color: PIECE_COLORS[(puzzle.slots.length + i) % PIECE_COLORS.length],
      })
    })
    return list
  }, [puzzle])

  // ---- クラスごとのジオメトリ（押し出し + BVH） ----
  const geometries = useMemo(() => {
    const map = new Map<string, { geo: ExtrudeGeometry; bvh: MeshBVH }>()
    for (const [classId, proto] of puzzle.protos) {
      const shape = new Shape(proto.map((p) => new Vector2(p.x, p.y)))
      const geo = new ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false, steps: 1 })
      geo.translate(0, 0, -DEPTH / 2)
      geo.scale(SHAPE_SCALE, SHAPE_SCALE, SHAPE_SCALE)
      geo.computeVertexNormals()
      const bvh = new MeshBVH(geo)
      map.set(classId, { geo, bvh })
    }
    return map
  }, [puzzle])

  useEffect(() => {
    return () => {
      for (const { geo } of geometries.values()) geo.dispose()
    }
  }, [geometries])

  // ---- 散乱配置（シード付き乱数、最小間隔つき） ----
  const scatter = useMemo(() => {
    const rand = mulberry32(runId * 7919 + 13)
    const placed: Vector3[] = []
    const out: { pos: Vector3; quat: Quaternion }[] = []
    const R = SCATTER_RADIUS * SHAPE_SCALE
    for (let i = 0; i < pieces.length; i++) {
      let p = new Vector3()
      for (let attempt = 0; attempt < 40; attempt++) {
        const z = rand() * 2 - 1
        const th = rand() * Math.PI * 2
        const r = Math.sqrt(1 - z * z)
        p = new Vector3(r * Math.cos(th), r * Math.sin(th), z).multiplyScalar(R * (0.7 + rand() * 0.5))
        if (placed.every((q) => q.distanceTo(p) > R * 0.55)) break
      }
      placed.push(p)
      const quat = new Quaternion().setFromAxisAngle(
        new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(),
        rand() * Math.PI * 2,
      )
      out.push({ pos: p, quat })
    }
    return out
  }, [pieces, runId])

  // ---- グループref収集 → SurfaceEntry 通知 ----
  const groupRefs = useRef<Map<number, Group>>(new Map())
  const meshRefs = useRef<Map<number, Mesh>>(new Map())
  const setGroupRef = useCallback((id: number) => {
    return (g: Group | null) => {
      if (g) groupRefs.current.set(id, g)
      else groupRefs.current.delete(id)
    }
  }, [])
  const setMeshRef = useCallback((id: number) => {
    return (m: Mesh | null) => {
      if (m) meshRefs.current.set(id, m)
      else meshRefs.current.delete(id)
    }
  }, [])

  useEffect(() => {
    const entries: SurfaceEntry[] = []
    for (const piece of pieces) {
      const g = groupRefs.current.get(piece.id)
      const gb = geometries.get(piece.classId)
      if (g && gb) entries.push({ id: piece.id, bvh: gb.bvh, geometry: gb.geo, object: g })
    }
    if (entries.length === pieces.length) {
      onSurfaces(entries, SCATTER_RADIUS * SHAPE_SCALE * 2.2)
    }
  }, [pieces, geometries, onSurfaces, runId])

  // ---- 接続状態 ----
  const assigned = useRef<Map<number, Placement>>(new Map())
  const asmMatrix = useRef<Matrix4 | null>(null)
  const markA = useRef<Mark | null>(null)
  // 指定中の面（強調表示用。markA.current と同期）
  const [markedFace, setMarkedFace] = useState<Mark | null>(null)
  // 接続成功パーティクル
  const [bursts, setBursts] = useState<{ id: number; pos: [number, number, number] }[]>([])
  const burstId = useRef(0)
  const anim = useRef<{
    pieceId: number
    fromPos: Vector3
    fromQuat: Quaternion
    toPos: Vector3
    toQuat: Quaternion
    t: number
  } | null>(null)

  const pieceLabel = useCallback(
    (id: number) => {
      const p = pieces.find((x) => x.id === id)!
      const n = p.classId === 'tri' || p.classId === 'etri' ? '三角ピース' : 'ピース'
      return `${n} #${id}`
    },
    [pieces],
  )

  const pushHud = useCallback(() => {
    onHud({
      placed: assigned.current.size,
      total: puzzle.realCount,
      markedDesc: markA.current ? `${pieceLabel(markA.current.pieceId)} の面をマーク中` : null,
    })
  }, [onHud, puzzle, pieceLabel])

  // ---- 見ている側面の判定（レティクル中心からレイキャスト） ----
  const lookedEdge = useCallback((): { pieceId: number; edgeIdx: number } | 'TOP' | null => {
    const ray = new Raycaster()
    ray.setFromCamera(new Vector2(0, 0), camera)
    const meshes = [...meshRefs.current.values()]
    const hits = ray.intersectObjects(meshes, false)
    const hit = hits[0]
    if (!hit || !hit.face) return null

    // ヒットしたメッシュ → pieceId を逆引き
    let pieceId = -1
    for (const [id, m] of meshRefs.current) {
      if (m === hit.object) {
        pieceId = id
        break
      }
    }
    if (pieceId < 0) return null
    const piece = pieces.find((p) => p.id === pieceId)
    if (!piece) return null

    // 面法線（ジオメトリのローカル空間）。上下面（|nz|大）は接続対象外
    const n = hit.face.normal
    if (Math.abs(n.z) > 0.7) return 'TOP'

    const proto = puzzle.protos.get(piece.classId)!
    let bestIdx = 0
    let bestDot = -Infinity
    for (let i = 0; i < proto.length; i++) {
      const en = edgeOutwardNormal(proto, i)
      const d = en.x * n.x + en.y * n.y
      if (d > bestDot) {
        bestDot = d
        bestIdx = i
      }
    }
    return { pieceId, edgeIdx: bestIdx }
  }, [pieces, puzzle, camera])

  // ---- F キー: 面マーク / 接続試行, X: マーク解除 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return

      if (e.code === 'KeyX') {
        if (markA.current) {
          markA.current = null
          setMarkedFace(null)
          onMessage('MARK_CLEARED')
          pushHud()
        }
        return
      }
      if (e.code !== 'KeyF') return
      if (anim.current) {
        onMessage('ANIMATING')
        return
      }

      const edge = lookedEdge()
      if (!edge) return
      if (edge === 'TOP') {
        onMessage('TOP_FACE')
        return
      }

      if (!markA.current) {
        markA.current = edge
        setMarkedFace(edge)
        onMessage('MARKED')
        pushHud()
        return
      }
      if (markA.current.pieceId === edge.pieceId) {
        markA.current = edge
        setMarkedFace(edge)
        onMessage('REMARKED')
        pushHud()
        return
      }

      // ---- 接続試行 ----
      const result = tryConnect(puzzle, pieces, assigned.current, markA.current, edge)
      if (!result.ok) {
        // 失敗したら現在の指定を解除して1から選び直せるようにする
        markA.current = null
        setMarkedFace(null)
        if (statsRef?.current) statsRef.current.mistakes += 1
        onMessage(result.error)
        pushHud()
        return
      }

      // アンカー: 現在のワールド位置を保つピース。組立フレームを確定する
      const anchorPl = result.placements.find((p) => p.pieceId === result.anchorPieceId)
      if (anchorPl && !asmMatrix.current) {
        const g = groupRefs.current.get(result.anchorPieceId)!
        g.updateWorldMatrix(true, false)
        const tm = t2ToMatrix(anchorPl.placement.t, new Matrix4())
        asmMatrix.current = new Matrix4().multiplyMatrices(g.matrixWorld, tm.invert())
        assigned.current.set(result.anchorPieceId, anchorPl.placement)
      }

      // アンカー以外（=飛んでいくピース）をアニメーションで配置
      for (const { pieceId, placement } of result.placements) {
        if (pieceId === result.anchorPieceId) continue
        const g = groupRefs.current.get(pieceId)!
        const target = new Matrix4().multiplyMatrices(
          asmMatrix.current!,
          t2ToMatrix(placement.t, new Matrix4()),
        )
        const toPos = new Vector3()
        const toQuat = new Quaternion()
        const sc = new Vector3()
        target.decompose(toPos, toQuat, sc)
        anim.current = {
          pieceId,
          fromPos: g.position.clone(),
          fromQuat: g.quaternion.clone(),
          toPos,
          toQuat,
          t: 0,
        }
        assigned.current.set(pieceId, placement)
        // 接続成功パーティクル
        const bid = burstId.current++
        setBursts((b) => [...b, { id: bid, pos: [toPos.x, toPos.y, toPos.z] }])
      }

      markA.current = null
      setMarkedFace(null)
      onMessage('CONNECTED')
      pushHud()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, puzzle, pieces, lookedEdge, onMessage, pushHud, statsRef])

  // ---- クリックワープ ----
  useEffect(() => {
    const downPos = { x: 0, y: 0, lockedAtDown: false }
    const onDown = (e: PointerEvent) => {
      downPos.x = e.clientX
      downPos.y = e.clientY
      downPos.lockedAtDown = !!document.pointerLockElement
    }
    const onUp = (e: PointerEvent) => {
      if (!active) return
      if (e.target !== gl.domElement) return
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
      if (moved > 6) return // ドラッグ視点と区別
      // このクリックで Pointer Lock を取得した場合はワープしない
      if (!downPos.lockedAtDown && document.pointerLockElement) return
      const ray = new Raycaster()
      ray.setFromCamera(new Vector2(0, 0), camera)
      const meshes = [...meshRefs.current.values()]
      const hits = ray.intersectObjects(meshes, false)
      const hit = hits[0]
      if (!hit || !hit.face) return
      const nWorld = hit.face.normal
        .clone()
        .transformDirection(hit.object.matrixWorld)
        .normalize()
      commandRef.current = { type: 'teleport', point: hit.point.clone(), normal: nWorld }
      if (statsRef?.current) statsRef.current.warps += 1
      audioWarp()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [active, camera, gl, commandRef, statsRef])

  // ---- 接続アニメーション ----
  useFrame((_, delta) => {
    const a = anim.current
    if (!a) return
    a.t = Math.min(1, a.t + delta / ANIM_DURATION)
    const k = 1 - Math.pow(1 - a.t, 3) // easeOutCubic
    const g = groupRefs.current.get(a.pieceId)
    if (g) {
      g.position.lerpVectors(a.fromPos, a.toPos, k)
      g.quaternion.slerpQuaternions(a.fromQuat, a.toQuat, k)
    }
    if (a.t >= 1) {
      anim.current = null
      if (assigned.current.size >= puzzle.realCount) {
        // 正解発表カメラ用に完成形の中心・大きさを計算
        const ids = [...assigned.current.keys()]
        const wp = new Vector3()
        const centroid = new Vector3()
        let n = 0
        for (const id of ids) {
          const gg = groupRefs.current.get(id)
          if (!gg) continue
          gg.getWorldPosition(wp)
          centroid.add(wp)
          n++
        }
        let info: { center: [number, number, number]; radius: number } = {
          center: [0, 0, 0],
          radius: SHAPE_SCALE * 6,
        }
        if (n > 0) {
          centroid.divideScalar(n)
          let rad = 0
          for (const id of ids) {
            const gg = groupRefs.current.get(id)
            if (!gg) continue
            gg.getWorldPosition(wp)
            const piece = pieces.find((p) => p.id === id)!
            const gb = geometries.get(piece.classId)!
            if (!gb.geo.boundingSphere) gb.geo.computeBoundingSphere()
            const geoR = gb.geo.boundingSphere?.radius ?? SHAPE_SCALE * 3
            rad = Math.max(rad, wp.distanceTo(centroid) + geoR)
          }
          info = { center: [centroid.x, centroid.y, centroid.z], radius: rad }
        }
        onMessage('COMPLETE')
        onComplete(info)
      }
    }
  })

  // sceneへの参照warning回避（未使用防止）
  void scene

  return (
    <>
      {pieces.map((piece, i) => {
        const gb = geometries.get(piece.classId)!
        return (
          <group
            key={`${runId}-${piece.id}`}
            ref={setGroupRef(piece.id)}
            position={scatter[i].pos}
            quaternion={scatter[i].quat}
          >
            <mesh ref={setMeshRef(piece.id)} geometry={gb.geo}>
              <meshStandardMaterial color={piece.color} roughness={0.6} metalness={0.05} />
            </mesh>
            {markedFace && markedFace.pieceId === piece.id && (
              <FaceHighlight
                proto={puzzle.protos.get(piece.classId)!}
                edgeIdx={markedFace.edgeIdx}
              />
            )}
          </group>
        )
      })}
      {bursts.map((b) => (
        <ConnectBurst
          key={b.id}
          pos={b.pos}
          onDone={() => setBursts((list) => list.filter((x) => x.id !== b.id))}
        />
      ))}
    </>
  )
}
