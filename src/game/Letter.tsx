import { useEffect, useMemo } from 'react'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { MeshBVH } from 'three-mesh-bvh'
import { LETTER_SIZE, type SurfaceData } from './types'
import fontData from './fontdata.json'

// フォントはバンドルに同梱（63KB）。実行時 fetch が不要になり、
// 単一HTMLファイルへのビルドやオフライン動作が可能になる
const font = new FontLoader().parse(fontData as unknown as Parameters<FontLoader['parse']>[0])

interface LetterProps {
  letter: string
  scale: number
  onReady: (data: SurfaceData) => void
}

/**
 * お題のアルファベットを 3D メッシュとして原点に生成する。
 *
 * 設計メモ:
 * - drei の <Text3D> + <Center> ではなく TextGeometry を直接使う。
 *   ジオメトリをワールド原点にベイク（center + scale をジオメトリ側に焼き込み）することで、
 *   BVH の最近接点クエリが「ローカル空間 = ワールド空間」で完結し、
 *   毎フレームの座標変換が不要になる。
 * - ベベルを大きめ・分割数を多めにして角を丸め、面から面へ歩いて渡れるようにする。
 * - スケールはジオメトリに直接焼き込むため、×100 でも Transform の入れ子が発生しない。
 */
export function Letter({ letter, scale, onReady }: LetterProps) {
  const geometry = useMemo(() => {
    const geo = new TextGeometry(letter, {
      font,
      size: LETTER_SIZE,
      depth: LETTER_SIZE * 0.35,
      curveSegments: 32,
      bevelEnabled: true,
      bevelThickness: LETTER_SIZE * 0.09,
      bevelSize: LETTER_SIZE * 0.07,
      bevelSegments: 16,
    })
    geo.center()
    geo.scale(scale, scale, scale)
    geo.computeVertexNormals()
    return geo
  }, [letter, scale])

  const surface = useMemo<SurfaceData>(() => {
    // MeshBVH はインデックスが無ければ自動生成してジオメトリに付与する
    const bvh = new MeshBVH(geometry)
    geometry.computeBoundingSphere()
    return {
      bvh,
      geometry,
      boundingRadius: geometry.boundingSphere?.radius ?? LETTER_SIZE * scale,
    }
  }, [geometry, scale])

  useEffect(() => {
    onReady(surface)
  }, [surface, onReady])

  useEffect(() => {
    return () => geometry.dispose()
  }, [geometry])

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color="#d8956b"
        roughness={0.55}
        metalness={0.08}
        flatShading={false}
      />
    </mesh>
  )
}
