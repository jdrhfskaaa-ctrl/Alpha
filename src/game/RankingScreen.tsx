import { useMemo, useState } from 'react'
import {
  categoryKey,
  gametypeLabel,
  getBoard,
  modeLabel,
  variantLabel,
  variantsFor,
  type GameType,
} from './leaderboard'

interface RankingScreenProps {
  onClose: () => void
}

const GTYPES: GameType[] = ['solo', 'endless']
const MODES_BY_TYPE: Record<GameType, string[]> = {
  solo: ['alphabet', 'image', 'shape'],
  endless: ['alphabet', 'shape'], // エンドレスは画像なし
}

/** 上位3件を段階的に大きく豪華に表示する表彰台 */
function Podium({ entries, isEndless }: { entries: ReturnType<typeof getBoard>; isEndless: boolean }) {
  const fmt = (score: number) => (isEndless ? `${score}問` : score.toLocaleString())
  // 表示順: 2位・1位・3位（中央を最大に）
  const order = [1, 0, 2]
  return (
    <div className="podium">
      {order.map((i) => {
        const e = entries[i]
        const place = i + 1
        return (
          <div key={place} className={`podium-col place-${place} ${e ? '' : 'empty'}`}>
            <div className="podium-medal">{place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'}</div>
            {e ? (
              <>
                <div className="podium-name">{e.name || '名無し'}</div>
                <div className="podium-score">{fmt(e.score)}</div>
                <div className="podium-detail">{e.detail}</div>
              </>
            ) : (
              <div className="podium-empty">—</div>
            )}
            <div className="podium-base">{place}</div>
          </div>
        )
      })}
    </div>
  )
}

export function RankingScreen({ onClose }: RankingScreenProps) {
  const [gtype, setGtype] = useState<GameType>('solo')
  const [mode, setMode] = useState('shape')
  const [variant, setVariant] = useState('easy')

  const modes = MODES_BY_TYPE[gtype]
  const effMode = modes.includes(mode) ? mode : modes[0]
  const variants = variantsFor(effMode)
  const effVariant = variants.includes(variant) ? variant : variants[0]

  const key = categoryKey(gtype, effMode, effVariant)
  const board = useMemo(() => getBoard(key), [key])
  const isEndless = gtype === 'endless'
  const fmt = (score: number) => (isEndless ? `${score}問` : score.toLocaleString())

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="ranking-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>ランキング</h2>
          <button className="settings-close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>

        {/* 部門セレクタ */}
        <div className="rank-sel">
          {GTYPES.map((g) => (
            <button key={g} className={gtype === g ? 'on' : ''} onClick={() => setGtype(g)}>
              {gametypeLabel(g)}
            </button>
          ))}
        </div>
        <div className="rank-sel">
          {modes.map((m) => (
            <button
              key={m}
              className={effMode === m ? 'on' : ''}
              onClick={() => setMode(m)}
            >
              {modeLabel(m)}
            </button>
          ))}
        </div>
        <div className="rank-sel">
          {variants.map((v) => (
            <button
              key={v}
              className={effVariant === v ? 'on' : ''}
              onClick={() => setVariant(v)}
            >
              {variantLabel(v)}
            </button>
          ))}
        </div>

        {board.length === 0 ? (
          <p className="rank-empty">まだ記録がありません。プレイして最初の記録を作ろう！</p>
        ) : (
          <>
            <Podium entries={board} isEndless={isEndless} />
            {board.length > 3 && (
              <div className="rank-list">
                {board.slice(3).map((e, i) => (
                  <div key={i} className="rank-row">
                    <span className="rank-pos">{i + 4}</span>
                    <span className="rank-name">{e.name || '名無し'}</span>
                    <span className="rank-detail">{e.detail}</span>
                    <span className="rank-score">{fmt(e.score)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
