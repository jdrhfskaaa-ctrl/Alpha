import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { Letter } from './Letter'
import { ImagePlatform } from './ImagePlatform'
import { Player, type PlayerCommand, type StandInfo } from './Player'
import { ShapeStage, type ShapeHud, type ShapeMessage } from './ShapeStage'
import type { RoundStats } from './score'
import { SHAPE_SCALE, type Stage, type SurfaceData, type SurfaceEntry } from './types'

/** シード付きPRNG（render中の Math.random は react-hooks/purity 違反のため） */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * スケール非依存の星空。
 * sizeAttenuation: false（画面上のピクセルサイズ固定）なので
 * どのスケールでも星の見た目が変わらない。
 */
function Starfield({ scale }: { scale: number }) {
  const geometry = useMemo(() => {
    const rand = mulberry32(20260715)
    const count = 1200
    const radius = 3000 * scale
    const positions = new Float32Array(count * 3)
    const v = new Vector3()
    for (let i = 0; i < count; i++) {
      const z = rand() * 2 - 1
      const theta = rand() * Math.PI * 2
      const r = Math.sqrt(1 - z * z)
      v.set(r * Math.cos(theta), r * Math.sin(theta), z)
      v.multiplyScalar(radius * (0.6 + rand() * 0.4))
      positions[i * 3] = v.x
      positions[i * 3 + 1] = v.y
      positions[i * 3 + 2] = v.z
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geo
  }, [scale])

  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={1.8}
        sizeAttenuation={false}
        color="#cfe4ff"
        transparent
        opacity={0.85}
        fog={false}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

/** 正解発表の演出情報（土台中心・大きさ・見る方向） */
export interface RevealInfo {
  center: [number, number, number]
  radius: number
}

const REVEAL_DURATION = 3.0 // 近距離→最大視野までの秒数

/** モードごとの俯瞰方向（この方向からカメラが土台を見る） */
function revealDirFor(kind: Stage['kind']): Vector3 {
  if (kind === 'image') return new Vector3(0.1, 0.75, 0.6).normalize() // 上から斜め（画像は上面）
  return new Vector3(0.12, 0.35, 1.0).normalize() // 正面やや上（文字・図形は面を正面から）
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/**
 * 正解発表カメラ。土台中心を見つめたまま、近距離から最大視野まで
 * REVEAL_DURATION 秒かけてドリーアウトする。
 */
function RevealCamera({ center, radius, dir }: { center: Vector3; radius: number; dir: Vector3 }) {
  const camera = useThree((s) => s.camera)
  const start = useRef<number | null>(null)
  const near = radius * 0.6 // 全体像が見えない近距離
  const far = radius * 3.4 // 全体を俯瞰できる最大視野
  const up = useMemo(
    () => (Math.abs(dir.y) > 0.9 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0)),
    [dir],
  )

  useFrame((state) => {
    if (start.current === null) start.current = state.clock.elapsedTime
    const t = Math.min(1, (state.clock.elapsedTime - start.current) / REVEAL_DURATION)
    const dist = near + (far - near) * easeInOut(t)
    camera.position.copy(center).addScaledVector(dir, dist)
    camera.up.copy(up)
    camera.lookAt(center)
  })

  return null
}

/** 背景の巨大な緑「正解」文字（土台の後ろに配置し、カメラ方向を向く） */
function RevealText({ center, radius, dir }: { center: Vector3; radius: number; dir: Vector3 }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#3ee08a'
    ctx.font = 'bold 400px "Hiragino Sans", "Yu Gothic", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('正解', canvas.width / 2, canvas.height / 2 + 20)
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    return tex
  }, [])

  const position = useMemo(
    () => center.clone().addScaledVector(dir, -radius * 4.0),
    [center, dir, radius],
  )
  const quaternion = useMemo(() => {
    const q = new Quaternion()
    q.setFromUnitVectors(new Vector3(0, 0, 1), dir)
    return q
  }, [dir])

  // 背景の半分以上を埋める大きさ（従来の約5倍）
  const w = radius * 27.5
  const h = radius * 13.75

  return (
    <mesh position={position} quaternion={quaternion}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  )
}

/** 正解発表中に土台まわりで舞う祝祭パーティクル */
function CorrectParticles({ center, radius }: { center: Vector3; radius: number }) {
  const COUNT = 280
  const spread = radius * 2.4

  // 表示用ジオメトリ（位置は毎フレーム更新、色は固定）
  const geo = useMemo(() => {
    const rand = mulberry32(9999)
    const colors = new Float32Array(COUNT * 3)
    const palette = [
      [0.49, 0.95, 0.82],
      [1.0, 0.84, 0.3],
      [1.0, 1.0, 1.0],
    ]
    for (let i = 0; i < COUNT; i++) {
      const c = palette[Math.floor(rand() * palette.length)]
      colors[i * 3] = c[0]
      colors[i * 3 + 1] = c[1]
      colors[i * 3 + 2] = c[2]
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(COUNT * 3), 3))
    g.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return g
  }, [])

  // 速度・寿命は可変なので ref に保持（effect で初期化）
  const stateRef = useRef<{ vel: Float32Array; life: Float32Array } | null>(null)
  useEffect(() => {
    const rand = mulberry32(1234)
    const vel = new Float32Array(COUNT * 3)
    const life = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      const dir = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize()
      const sp = (0.4 + rand() * 0.9) * spread
      vel[i * 3] = dir.x * sp
      vel[i * 3 + 1] = dir.y * sp
      vel[i * 3 + 2] = dir.z * sp
      life[i] = rand()
    }
    stateRef.current = { vel, life }
  }, [spread])

  useEffect(() => () => geo.dispose(), [geo])

  useFrame((_, delta) => {
    const st = stateRef.current
    if (!st) return
    const dt = Math.min(delta, 1 / 30)
    const posAttr = geo.getAttribute('position') as Float32BufferAttribute
    const LIFE = 2.4
    for (let i = 0; i < COUNT; i++) {
      let l = st.life[i] + dt / LIFE
      if (l >= 1) l -= 1
      st.life[i] = l
      const r = easeInOut(l)
      posAttr.setXYZ(i, st.vel[i * 3] * r, st.vel[i * 3 + 1] * r, st.vel[i * 3 + 2] * r)
    }
    posAttr.needsUpdate = true
  })

  return (
    <points geometry={geo} position={center}>
      <pointsMaterial
        size={radius * 0.09}
        vertexColors
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={AdditiveBlending}
        fog={false}
      />
    </points>
  )
}

/** 歩いた軌跡（足跡）。薄く小さい点で、答えの形は読めない粒度に留める */
function Trail({
  dataRef,
  visible,
}: {
  dataRef: React.RefObject<number[]>
  visible: boolean
}) {
  const MAX = 500
  const geo = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX * 3), 3))
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])

  useFrame(() => {
    const arr = dataRef.current
    if (!arr) return
    const n = Math.min(MAX, Math.floor(arr.length / 3))
    const posAttr = geo.getAttribute('position') as Float32BufferAttribute
    const start = arr.length - n * 3
    for (let i = 0; i < n; i++) {
      posAttr.setXYZ(i, arr[start + i * 3], arr[start + i * 3 + 1], arr[start + i * 3 + 2])
    }
    posAttr.needsUpdate = true
    geo.setDrawRange(0, n)
  })

  if (!visible) return null
  return (
    <points geometry={geo}>
      <pointsMaterial
        size={8}
        sizeAttenuation={false}
        color="#ffd23e"
        transparent
        opacity={0.85}
        depthWrite={false}
        depthTest={false}
        blending={AdditiveBlending}
        fog={false}
      />
    </points>
  )
}

interface GameSceneProps {
  stage: Stage
  scale: number
  active: boolean
  runId: number
  reveal?: boolean
  statsRef?: React.RefObject<RoundStats | null>
  onDebug?: (pos: Vector3) => void
  // ---- 図形モード用（アルファベット/画像モードでは未使用） ----
  onShapeMessage?: (msg: ShapeMessage) => void
  onShapeHud?: (hud: ShapeHud) => void
  onShapeComplete?: () => void
}

export function GameScene({
  stage,
  scale,
  active,
  runId,
  reveal = false,
  statsRef,
  onDebug,
  onShapeMessage,
  onShapeHud,
  onShapeComplete,
}: GameSceneProps) {
  // 図形モードは常に×3。それ以外は選択されたサイズ。
  const effScale = stage.kind === 'shape' ? SHAPE_SCALE : scale

  const [surfaces, setSurfaces] = useState<SurfaceEntry[]>([])
  const [probeRadius, setProbeRadius] = useState(20)
  const [spawned, setSpawned] = useState(false)

  const standRef = useRef<StandInfo | null>(null)
  const commandRef = useRef<PlayerCommand | null>(null)
  // 図形モードの完成形の中心・大きさ（ShapeStage が完成時に通知）
  const [shapeRevealInfo, setShapeRevealInfo] = useState<RevealInfo | null>(null)

  // ---- 探索トレイル ----
  const trailRef = useRef<number[]>([])
  const [trailVisible, setTrailVisible] = useState(true)
  const footOffset = 0.35 * Math.pow(effScale, 0.3)
  const handleTrail = useCallback(
    (pos: Vector3, up: Vector3) => {
      const arr = trailRef.current
      // プレイヤー中心から足元（表面直上）へ寄せて記録
      arr.push(pos.x - up.x * footOffset, pos.y - up.y * footOffset, pos.z - up.z * footOffset)
      if (arr.length > 500 * 3) arr.splice(0, arr.length - 500 * 3)
    },
    [footOffset],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyM') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      setTrailVisible((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // アルファベット/画像モードの単一メッシュを SurfaceEntry でラップするための
  // identity オブジェクト（変換を持たないので matrixWorld = 単位行列）
  const identityObject = useMemo(() => new Object3D(), [])

  const handleSpawned = useCallback(() => setSpawned(true), [])

  // ---- アルファベット/画像: 単一サーフェス → SurfaceEntry[] に変換 ----
  const handleReady = useCallback(
    (data: SurfaceData) => {
      setSurfaces([{ id: 0, bvh: data.bvh, geometry: data.geometry, object: identityObject }])
      setProbeRadius(data.boundingRadius * 1.25)
    },
    [identityObject],
  )

  // ---- 図形: ShapeStage が全ピースのサーフェスを供給 ----
  const handleShapeSurfaces = useCallback((entries: SurfaceEntry[], probe: number) => {
    setSurfaces(entries)
    setProbeRadius(probe)
  }, [])

  // ---- 図形の完成通知（完成形の中心・大きさを受け取り、親へも伝える） ----
  const handleShapeComplete = useCallback(
    (info: RevealInfo) => {
      setShapeRevealInfo(info)
      onShapeComplete?.()
    },
    [onShapeComplete],
  )

  // reveal 中に使うカメラターゲット（state のみで算出。ref は読まない）
  const revealTarget: RevealInfo | null = reveal
    ? {
        center: stage.kind === 'shape' && shapeRevealInfo ? shapeRevealInfo.center : [0, 0, 0],
        radius:
          stage.kind === 'shape' && shapeRevealInfo ? shapeRevealInfo.radius : probeRadius / 1.25,
      }
    : null

  return (
    <>
      <Canvas
        // logarithmicDepthBuffer: 巨大スケール時の Z ファイティング対策
        gl={{ logarithmicDepthBuffer: true, antialias: true }}
        camera={{
          fov: 78,
          near: 0.05, // プレイヤーは常に人間サイズ基準なので near は固定
          far: 50000 * effScale,
          position: [0, 0, 30 * effScale],
        }}
        onPointerDown={(e) => {
          if (active && !document.pointerLockElement) {
            // iframe 内など Pointer Lock 不可の環境では失敗するが、
            // その場合はドラッグ視点にフォールバックするため握りつぶす
            try {
              const p = (e.target as HTMLCanvasElement).requestPointerLock() as unknown
              if (p instanceof Promise) p.catch(() => {})
            } catch {
              /* noop */
            }
          }
        }}
      >
        <color attach="background" args={['#070a18']} />
        {/* フォグは sqrt(scale) 基準:
            小サイズではほぼ無風、大サイズでは遠方が霞んで
            「全体像が一目で見えない」= 難易度そのものになる */}
        <fog attach="fog" args={['#070a18', 60 * Math.sqrt(effScale), 900 * Math.sqrt(effScale)]} />

        <hemisphereLight args={['#a8c8ff', '#3a2545', 0.55]} />
        <directionalLight
          position={[40 * effScale, 60 * effScale, 30 * effScale]}
          intensity={1.7}
          color="#ffe4bd"
        />
        <directionalLight
          position={[-30 * effScale, -40 * effScale, -20 * effScale]}
          intensity={0.35}
          color="#6f8cff"
        />
        <ambientLight intensity={0.12} />

        <Starfield scale={effScale} />

        <Suspense fallback={null}>
          {stage.kind === 'alphabet' && (
            <Letter letter={stage.letter} scale={effScale} onReady={handleReady} />
          )}
          {stage.kind === 'image' && (
            <ImagePlatform url={stage.url} scale={effScale} onReady={handleReady} />
          )}
          {stage.kind === 'shape' && (
            <ShapeStage
              puzzleId={stage.puzzleId}
              runId={runId}
              active={active}
              onSurfaces={handleShapeSurfaces}
              commandRef={commandRef}
              statsRef={statsRef}
              onMessage={onShapeMessage ?? (() => {})}
              onHud={onShapeHud ?? (() => {})}
              onComplete={handleShapeComplete}
            />
          )}

          {/* 通常プレイ中はプレイヤーがカメラを制御。正解発表中は停止して
              RevealCamera に明け渡す */}
          {surfaces.length > 0 && !reveal && (
            <Player
              surfaces={surfaces}
              probeRadius={probeRadius}
              scale={effScale}
              active={active}
              runId={runId}
              onDebug={onDebug}
              onSpawned={handleSpawned}
              statsRef={statsRef}
              standRef={standRef}
              commandRef={commandRef}
              onTrail={handleTrail}
              spawnDir={stage.kind === 'image' ? [0, 1, 0] : undefined}
            />
          )}

          {/* 探索トレイル（M キーで表示切替。reveal 中は隠す） */}
          {!reveal && <Trail dataRef={trailRef} visible={trailVisible} />}

          {/* ---- 正解発表モード ---- */}
          {reveal &&
            revealTarget &&
            (() => {
              const center = new Vector3(...revealTarget.center)
              const dir = revealDirFor(stage.kind)
              return (
                <>
                  <RevealCamera center={center} radius={revealTarget.radius} dir={dir} />
                  <RevealText center={center} radius={revealTarget.radius} dir={dir} />
                  <CorrectParticles center={center} radius={revealTarget.radius} />
                </>
              )
            })()}
        </Suspense>
      </Canvas>

      {/* スポーン完了までシーンを覆う暗転カバー。
          プレイヤー視点が確定する前にカメラが土台の全体像（＝答え）を
          映してしまうのを防ぐ */}
      <div className={`spawn-cover ${spawned || reveal ? 'hidden' : ''}`} aria-hidden="true">
        <span>{stage.kind === 'shape' ? '展開中…' : '降下中…'}</span>
      </div>
    </>
  )
}
