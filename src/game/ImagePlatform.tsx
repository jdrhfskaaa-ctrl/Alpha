import { useEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import {
  BoxGeometry,
  ClampToEdgeWrapping,
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
} from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { SurfaceData } from './types'

// ×1 のときの土台寸法（正方形スラブ）
const PLATFORM_SIZE = 40
const PLATFORM_THICK = 5

interface ImagePlatformProps {
  url: string
  scale: number
  onReady: (data: SurfaceData) => void
}

/**
 * 画像モードの土台。
 * どんな画像が来ても受けられる大きな正方形スラブの上面に、
 * アスペクト比を維持した中央トリミング（cover-crop）で画像を貼る。
 * 吸着システムは Letter と同じ SurfaceData 契約なので Player は無変更で動く。
 */
export function ImagePlatform({ url, scale, onReady }: ImagePlatformProps) {
  const loaded = useLoader(TextureLoader, url)

  // useLoader の戻り値はキャッシュ共有されるため直接ミューテートせず、
  // クローンを生成してそこに cover-crop 設定を焼き込む
  const texture = useMemo(() => {
    const tex = loaded.clone()
    tex.colorSpace = SRGBColorSpace
    tex.wrapS = ClampToEdgeWrapping
    tex.wrapT = ClampToEdgeWrapping
    const img = tex.image as { width?: number; height?: number } | undefined
    if (img?.width && img?.height) {
      // cover-crop: 正方形の上面に、画像の中央正方形領域をはめ込む
      const a = img.width / img.height
      if (a > 1) {
        tex.repeat.set(1 / a, 1)
        tex.offset.set((1 - 1 / a) / 2, 0)
      } else {
        tex.repeat.set(1, a)
        tex.offset.set(0, (1 - a) / 2)
      }
    }
    tex.needsUpdate = true
    return tex
  }, [loaded])

  const geometry = useMemo(
    () => new BoxGeometry(PLATFORM_SIZE * scale, PLATFORM_THICK * scale, PLATFORM_SIZE * scale),
    [scale],
  )

  const materials = useMemo(() => {
    const side = new MeshStandardMaterial({ color: '#2b3355', roughness: 0.7 })
    const bottom = new MeshStandardMaterial({ color: '#1a2038', roughness: 0.8 })
    const top = new MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0 })
    // BoxGeometry のマテリアル順: +x, -x, +y(上面), -y(底面), +z, -z
    return [side, side, top, bottom, side, side]
  }, [texture])

  const surface = useMemo<SurfaceData>(() => {
    const bvh = new MeshBVH(geometry)
    geometry.computeBoundingSphere()
    return {
      bvh,
      geometry,
      boundingRadius: geometry.boundingSphere?.radius ?? PLATFORM_SIZE * scale,
    }
  }, [geometry, scale])

  useEffect(() => {
    onReady(surface)
  }, [surface, onReady])

  useEffect(() => {
    return () => {
      geometry.dispose()
      materials.forEach((m) => m.dispose())
      texture.dispose()
    }
  }, [geometry, materials, texture])

  return <mesh geometry={geometry} material={materials} />
}
