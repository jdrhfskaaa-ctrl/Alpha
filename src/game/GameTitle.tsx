import { GLYPHS, LAYOUT, fillAt, hash } from './titleGlyphs'

const { LINE1, LINE2, CELL, GAP, LINE_H, W1, W2, VB_W, VB_H } = LAYOUT

export function GameTitle() {
  const pieces: { points: string; fill: string; delay: number; dx: number; dy: number; rot: number }[] =
    []
  let idx = 0

  const place = (chars: string[], originX: number, originY: number) => {
    chars.forEach((ch, ci) => {
      const glyph = GLYPHS[ch]
      if (!glyph) return
      const ox = originX + ci * (CELL + GAP)
      glyph.forEach((poly) => {
        const pts = poly.map(([x, y]) => `${(x + ox).toFixed(1)},${(y + originY).toFixed(1)}`).join(' ')
        const h1 = hash(idx)
        const h2 = hash(idx + 100)
        const h3 = hash(idx + 200)
        // ピースの重心Xでグラデーション位置を決める
        const cx = poly.reduce((a, [x]) => a + x, 0) / poly.length + ox
        pieces.push({
          points: pts,
          fill: fillAt(cx / VB_W),
          delay: idx * 0.045,
          // 散らばった初期位置（画面外方向へランダムに飛ばす）
          dx: (h1 - 0.5) * 260,
          dy: (h2 - 0.5) * 220,
          rot: (h3 - 0.5) * 120,
        })
        idx++
      })
    })
  }

  place(LINE1, 0, 0)
  place(LINE2, (W1 - W2) / 2, LINE_H)

  return (
    <svg
      className="logo"
      viewBox={`-14 -10 ${VB_W + 28} ${VB_H + 20}`}
      role="img"
      aria-label="グラビティークイズ"
    >
      {pieces.map((p, i) => (
        <polygon
          key={i}
          className="logo-piece"
          points={p.points}
          fill={p.fill}
          style={
            {
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
              animationDelay: `${p.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </svg>
  )
}
