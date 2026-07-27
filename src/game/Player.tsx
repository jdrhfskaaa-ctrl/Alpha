import { useCallback, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, PerspectiveCamera, Triangle, Vector3 } from 'three'
import { isDown } from './input'
import { footstep as audioFootstep, reorient as audioReorient } from './audio'
import { getSettings, subscribeSettings, type Settings } from './settings'
import type { RoundStats } from './score'
import type { SurfaceEntry } from './types'

// ---- チューニング定数 ----
// 【重要】プレイヤーの寸法は scale に等倍追従させない。
// 全部を等倍でスケールすると相対関係が同一になり難易度が無意味になる。
const PLAYER_RADIUS = 0.35
const BASE_SPEED = 5.5
const SPRINT_MULT = 1.8
const EYE_HEIGHT = 0.55
const MOUSE_SENS = 0.0022 // 感度1.0時の基準
const PITCH_LIMIT = 1.45
/** 身長のスケール追従度: ×1→1.0倍 / ×3→約1.4倍 / ×30→約2.8倍 */
const BODY_SCALE_EXP = 0.3

// ---- 使い回しの一時オブジェクト ----
const tmpRight = new Vector3()
const tmpWish = new Vector3()
const tmpLook = new Vector3()
const tmpTarget = new Vector3()
const tmpNormal = new Vector3()
const tmpFaceNormal = new Vector3()
const tmpLocal = new Vector3()
const tmpWorld = new Vector3()
const tmpMat = new Matrix4()
const tmpDelta = new Matrix4()
const tmpTri = new Triangle()
const hitInfo = { point: new Vector3(), distance: 0, faceIndex: 0 }

/** カメラFOVを設定に追従（変更時のみ）。render外のモジュール関数で行い純粋性制約を回避 */
function applyFov(camera: unknown, fov: number) {
  if (camera instanceof PerspectiveCamera && camera.fov !== fov) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
}

export interface PlayerCommand {
  type: 'teleport'
  point: Vector3
  normal: Vector3
}

export interface StandInfo {
  surfaceId: number
  faceIndex: number
}

interface BestHit {
  entry: SurfaceEntry
  worldPoint: Vector3
  faceIndex: number
  matrix: Matrix4
}

const best: BestHit = {
  entry: null as unknown as SurfaceEntry,
  worldPoint: new Vector3(),
  faceIndex: 0,
  matrix: new Matrix4(),
}

/** 複数サーフェスに対する最近接点（ワールド空間）。見つかれば best を埋めて true */
function multiClosest(surfaces: SurfaceEntry[], worldPos: Vector3): boolean {
  let found = false
  let bestDist = Infinity
  for (const entry of surfaces) {
    entry.object.updateWorldMatrix(true, false)
    tmpMat.copy(entry.object.matrixWorld).invert()
    tmpLocal.copy(worldPos).applyMatrix4(tmpMat)
    const res = entry.bvh.closestPointToPoint(tmpLocal, hitInfo)
    if (!res) continue
    tmpWorld.copy(hitInfo.point).applyMatrix4(entry.object.matrixWorld)
    const d = tmpWorld.distanceTo(worldPos)
    if (d < bestDist) {
      bestDist = d
      best.entry = entry
      best.worldPoint.copy(tmpWorld)
      best.faceIndex = hitInfo.faceIndex
      best.matrix.copy(entry.object.matrixWorld)
      found = true
    }
  }
  return found
}

/** faceIndex から三角形の面法線（ローカル）を out に計算 */
function faceNormalLocal(entry: SurfaceEntry, faceIndex: number, out: Vector3) {
  const index = entry.geometry.index!
  const pos = entry.geometry.attributes.position
  tmpTri.a.fromBufferAttribute(pos, index.getX(faceIndex * 3 + 0))
  tmpTri.b.fromBufferAttribute(pos, index.getX(faceIndex * 3 + 1))
  tmpTri.c.fromBufferAttribute(pos, index.getX(faceIndex * 3 + 2))
  tmpTri.getNormal(out)
}

interface PlayerProps {
  surfaces: SurfaceEntry[]
  /** スポーン・リスポーン時のプローブ半径（ワールド単位） */
  probeRadius: number
  scale: number
  active: boolean
  runId: number
  onDebug?: (pos: Vector3) => void
  onSpawned?: () => void
  /** 毎フレーム、現在立っているサーフェスと三角形indexを書き込む */
  standRef?: React.RefObject<StandInfo | null>
  /** 親からのコマンド（ワープなど）。消費したら null に戻す */
  commandRef?: React.RefObject<PlayerCommand | null>
  /** ラウンド統計（歩行距離を加算する） */
  statsRef?: React.RefObject<RoundStats | null>
  /** 足跡トレイル記録用コールバック（一定間隔でワールド座標と法線を通知） */
  onTrail?: (pos: Vector3, up: Vector3) => void
  /** 移動しているか（足音用）。速度の大きさを通知 */
  onMove?: (speed: number) => void
}

/**
 * 吸着重力プレイヤー（複数土台対応版）。
 * - 毎フレーム全サーフェスへの最近接点を取り、最も近い面に吸着する
 * - サーフェスは動いてよい（object.matrixWorld を毎回参照）。
 *   直前フレームで立っていたサーフェスが動いた場合、その差分変換を
 *   プレイヤーにも適用する = 動くピースに「乗れる」
 * - commandRef 経由でワープ（図形モードのクリック移動）を受け付ける
 */
export function Player({
  surfaces,
  probeRadius,
  scale,
  active,
  runId,
  onDebug,
  onSpawned,
  standRef,
  commandRef,
  statsRef,
  onTrail,
  onMove,
}: PlayerProps) {
  const camera = useThree((s) => s.camera)

  // 設定を購読してrefに保持（useFrame内で参照）
  const settings = useRef<Settings>(getSettings())
  useEffect(() => {
    settings.current = getSettings()
    return subscribeSettings((s) => {
      settings.current = s
    })
  }, [])
  const trailTimer = useRef(0)

  const pos = useRef(new Vector3())
  const up = useRef(new Vector3(0, 1, 0))
  const forward = useRef(new Vector3(0, 0, -1))
  const pitch = useRef(0)
  const debugTimer = useRef(0)
  const spawnedNotified = useRef(false)
  const attachedId = useRef<number | null>(null)
  const attachedPrevMatrix = useRef(new Matrix4())

  const bodyScale = Math.pow(scale, BODY_SCALE_EXP)
  const radius = PLAYER_RADIUS * bodyScale
  const eye = EYE_HEIGHT * bodyScale
  const moveScale = Math.sqrt(scale)

  const respawn = useCallback(() => {
    const dir = new Vector3().randomDirection()
    const probe = dir.multiplyScalar(probeRadius)
    if (!multiClosest(surfaces, probe)) return
    const n = probe.clone().sub(best.worldPoint).normalize()
    if (n.lengthSq() < 0.5) n.set(0, 1, 0)
    up.current.copy(n)
    pos.current.copy(best.worldPoint).addScaledVector(n, radius)
    const ref = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
    forward.current.crossVectors(ref, n).normalize()
    pitch.current = -0.15
    attachedId.current = null
  }, [surfaces, radius, probeRadius])

  // ---- スポーン（ラウンド開始・サーフェス確定時） ----
  useEffect(() => {
    respawn()
  }, [respawn, runId])

  // ---- マウス視点（Pointer Lock またはドラッグフォールバック） ----
  useEffect(() => {
    let dragging = false
    const onDown = (e: MouseEvent) => {
      if (e.button === 0) dragging = true
    }
    const onUp = () => {
      dragging = false
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!active) return
      if (!document.pointerLockElement && !dragging) return
      const cfg = settings.current
      const sens = MOUSE_SENS * cfg.sensitivity
      const invert = cfg.invertY ? -1 : 1
      forward.current.applyAxisAngle(up.current, -e.movementX * sens)
      pitch.current = Math.max(
        -PITCH_LIMIT,
        Math.min(PITCH_LIMIT, pitch.current - invert * e.movementY * sens),
      )
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [active])

  // ---- R キーでリスポーン ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || e.code !== 'KeyR') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      respawn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, respawn])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30)
    if (surfaces.length === 0) return

    // ---- コマンド消費（ワープ） ----
    if (commandRef?.current) {
      const cmd = commandRef.current
      commandRef.current = null
      if (cmd.type === 'teleport') {
        pos.current.copy(cmd.point).addScaledVector(cmd.normal, radius)
        up.current.copy(cmd.normal)
        forward.current.addScaledVector(up.current, -forward.current.dot(up.current))
        if (forward.current.lengthSq() < 1e-8) {
          const ref = Math.abs(up.current.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
          forward.current.crossVectors(ref, up.current)
        }
        forward.current.normalize()
        attachedId.current = null
      }
    }

    // ---- 動くサーフェスへの追従（乗り物処理） ----
    if (attachedId.current !== null) {
      const entry = surfaces.find((s) => s.id === attachedId.current)
      if (entry) {
        entry.object.updateWorldMatrix(true, false)
        if (!entry.object.matrixWorld.equals(attachedPrevMatrix.current)) {
          tmpMat.copy(attachedPrevMatrix.current).invert()
          tmpDelta.multiplyMatrices(entry.object.matrixWorld, tmpMat)
          pos.current.applyMatrix4(tmpDelta)
          up.current.transformDirection(tmpDelta).normalize()
          forward.current.transformDirection(tmpDelta).normalize()
        }
      }
    }

    // ---- 移動入力 → 接平面上の移動 ----
    if (active) {
      let f = 0
      let s = 0
      if (isDown('KeyW')) f += 1
      if (isDown('KeyS')) f -= 1
      if (isDown('KeyD')) s += 1
      if (isDown('KeyA')) s -= 1

      if (f !== 0 || s !== 0) {
        const speed =
          BASE_SPEED * moveScale * (isDown('ShiftLeft') || isDown('ShiftRight') ? SPRINT_MULT : 1)
        tmpRight.crossVectors(forward.current, up.current).normalize()
        tmpWish
          .set(0, 0, 0)
          .addScaledVector(forward.current, f)
          .addScaledVector(tmpRight, s)
          .normalize()
        const step = speed * dt
        pos.current.addScaledVector(tmpWish, step)
        // 歩行距離を統計に加算（スケール非依存の実距離感にするため /moveScale）
        if (statsRef?.current) statsRef.current.walkDistance += step / moveScale
        onMove?.(speed / moveScale)
        audioFootstep(speed / moveScale, dt)
      } else {
        onMove?.(0)
      }
    } else {
      onMove?.(0)
    }

    // ---- 吸着（スナップ） ----
    if (!multiClosest(surfaces, pos.current)) return
    faceNormalLocal(best.entry, best.faceIndex, tmpFaceNormal)
    tmpFaceNormal.transformDirection(best.matrix).normalize()

    const worldDist = best.worldPoint.distanceTo(pos.current)
    if (worldDist > 1e-4) {
      tmpNormal.copy(pos.current).sub(best.worldPoint).normalize()
      if (tmpNormal.dot(tmpFaceNormal) < 0) tmpNormal.copy(tmpFaceNormal)
    } else {
      tmpNormal.copy(tmpFaceNormal)
    }

    pos.current.copy(best.worldPoint).addScaledVector(tmpNormal, radius)

    // 大きく面が変わった瞬間（エッジ越え・ピース移動）に再配向音
    const upDot = Math.min(1, Math.max(-1, up.current.dot(tmpNormal)))
    if (active && Math.acos(upDot) > 0.35) audioReorient()

    // 再配向スムージング（設定で酔いにくさを調整）
    const k = 1 - Math.exp(-settings.current.reorientSmooth * dt)
    up.current.lerp(tmpNormal, k).normalize()

    forward.current.addScaledVector(up.current, -forward.current.dot(up.current))
    if (forward.current.lengthSq() < 1e-8) {
      const ref = Math.abs(up.current.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
      forward.current.crossVectors(ref, up.current)
    }
    forward.current.normalize()

    // 立っているサーフェスを記録（乗り物処理・面マーク用）
    attachedId.current = best.entry.id
    attachedPrevMatrix.current.copy(best.matrix)
    if (standRef) standRef.current = { surfaceId: best.entry.id, faceIndex: best.faceIndex }

    // ---- カメラ ----
    tmpRight.crossVectors(forward.current, up.current).normalize()
    tmpLook.copy(forward.current).applyAxisAngle(tmpRight, pitch.current)
    camera.position.copy(pos.current).addScaledVector(up.current, eye)
    camera.up.copy(up.current)
    camera.lookAt(tmpTarget.copy(camera.position).add(tmpLook))

    // FOV を設定に追従（変更時のみ）
    applyFov(camera, settings.current.fov)

    // 足跡トレイル（0.25秒間隔、移動中のみ）
    if (onTrail) {
      trailTimer.current += dt
      if (trailTimer.current > 0.25) {
        trailTimer.current = 0
        onTrail(pos.current, up.current)
      }
    }

    // ---- デバッグ表示（10Hz に間引き） ----
    debugTimer.current += dt
    if (debugTimer.current > 0.1 && onDebug) {
      debugTimer.current = 0
      onDebug(pos.current)
    }

    // ---- スポーン完了通知（初回フレームのみ） ----
    if (!spawnedNotified.current) {
      spawnedNotified.current = true
      onSpawned?.()
    }
  })

  return null
}
