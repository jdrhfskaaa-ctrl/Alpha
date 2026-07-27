import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Vector3 } from 'three'
import { GameScene } from './game/GameScene'
import { clearInput, installInputListeners } from './game/input'
import { PUZZLES, pickAnyPuzzle, pickPuzzle, type PuzzleDef } from './game/shapes'
import type { ShapeHud, ShapeMessage } from './game/ShapeStage'
import { SettingsPanel } from './game/SettingsPanel'
import { RankingScreen } from './game/RankingScreen'
import * as audio from './game/audio'
import { EMPTY_STATS, computeSoloScore, endlessTiming, type RoundStats } from './game/score'
import {
  addScore,
  categoryKey,
  getPlayerName,
  setPlayerName,
  wouldRank,
} from './game/leaderboard'
import {
  APP_VERSION,
  SIZE_MODES,
  randomLetter,
  type Difficulty,
  type GameMode,
  type GamePhase,
  type SizeMode,
  type Stage,
} from './game/types'

installInputListeners()

interface UserImage {
  id: number
  url: string
  name: string
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---- 図形モード: メッセージ→日本語トースト ----
const SHAPE_MESSAGES: Record<ShapeMessage, { text: string; kind: 'good' | 'bad' | 'info' }> = {
  MARKED: { text: '面をマークした。別のピースの面に立ってFキー', kind: 'good' },
  REMARKED: { text: 'マークを付け替えた', kind: 'info' },
  CONNECTED: { text: 'くっついた！', kind: 'good' },
  COMPLETE: { text: '完成！', kind: 'good' },
  TOP_FACE: { text: '上面は繋げない。ピースの「側面」に立ってFキー', kind: 'bad' },
  SAME_PIECE: { text: '同じピースです', kind: 'bad' },
  BOTH_PLACED: { text: 'どちらも組み立て済みです', kind: 'bad' },
  NEED_CLUSTER: { text: '組み立て中の塊の面と繋げてください', kind: 'bad' },
  OUTER_FACE: { text: 'そこは外側の面。内側で接する面を選んで', kind: 'bad' },
  OCCUPIED: { text: 'そこには既に別のピースが入っています', kind: 'bad' },
  WRONG_PIECE: { text: 'このピースはそこには合いません', kind: 'bad' },
  WRONG_FACE: { text: 'つなげる面が違います', kind: 'bad' },
  NO_FIRST_FIT: { text: 'この2面同士はつながりません', kind: 'bad' },
  MARK_CLEARED: { text: 'マークを解除した', kind: 'info' },
  ANIMATING: { text: 'くっついている最中です…', kind: 'info' },
}

/** パズルのスロット多角形からお題シルエットのSVGを描く */
function ShapeSilhouette({ def, size = 96 }: { def: PuzzleDef; size?: number }) {
  const { polys, vb } = useMemo(() => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const s of def.slots) {
      for (const p of s.poly) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    const pad = 0.5
    const w = maxX - minX + pad * 2
    const h = maxY - minY + pad * 2
    // SVGはy下向きなので反転
    const polys = def.slots.map((s) =>
      s.poly.map((p) => `${(p.x - minX + pad).toFixed(2)},${(maxY - p.y + pad).toFixed(2)}`).join(' '),
    )
    return { polys, vb: `0 0 ${w.toFixed(2)} ${h.toFixed(2)}` }
  }, [def])

  return (
    <svg className="silhouette" width={size} height={size} viewBox={vb} aria-label={def.name}>
      {polys.map((pts, i) => (
        <polygon
          key={i}
          points={pts}
          fill="#d8956b"
          stroke="#070a18"
          strokeWidth={0.12}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('START')
  const [gameMode, setGameMode] = useState<GameMode>('alphabet')
  const [mode, setMode] = useState<SizeMode>(SIZE_MODES[0])
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  // ゲーム種別: 通常1問 or エンドレス
  const [gameType, setGameType] = useState<'solo' | 'endless'>('solo')
  // エンドレス用
  const [endlessLeft, setEndlessLeft] = useState(0)
  const [endlessCleared, setEndlessCleared] = useState(0)
  const [bonusFlash, setBonusFlash] = useState<{ text: string; key: number } | null>(null)
  const deadlineRef = useRef(0)
  const bonusKey = useRef(0)
  const clearedRef = useRef(0)
  const lastTickRef = useRef(0)
  const [stage, setStage] = useState<Stage>({ kind: 'alphabet', letter: 'A' })
  const [runId, setRunId] = useState(0)
  const [locked, setLocked] = useState(false)
  const [answer, setAnswer] = useState('')
  const [interacted, setInteracted] = useState(false)
  const [debugPos, setDebugPos] = useState<[number, number, number]>([0, 0, 0])
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [finalTime, setFinalTime] = useState(0)
  // ---- 画像モード ----
  const [images, setImages] = useState<UserImage[]>([])
  const [choices, setChoices] = useState<UserImage[]>([])
  const [targetImage, setTargetImage] = useState<UserImage | null>(null)
  const imageIdRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // ---- 図形モード ----
  const [showSettings, setShowSettings] = useState(false)
  const [showRanking, setShowRanking] = useState(false)
  // スコア登録の保留状態
  const [pending, setPending] = useState<{
    key: string
    score: number
    detail: string
    isEndless: boolean
    ranked: boolean
    saved: boolean
    rank: number
  } | null>(null)
  const [nameInput, setNameInput] = useState('')
  const statsRef = useRef<RoundStats>({ ...EMPTY_STATS })
  const [shapePuzzle, setShapePuzzle] = useState<PuzzleDef | null>(null)
  const [shapeHud, setShapeHud] = useState<ShapeHud>({ placed: 0, total: 0, markedDesc: null })
  const [toast, setToast] = useState<{ text: string; kind: string; key: number } | null>(null)
  const toastKey = useRef(0)

  const playing = phase === 'PLAYING'

  // タブタイトルにもバージョンを出す（どのファイルを開いているか確認用）
  useEffect(() => {
    document.title = `ALPHA GRAVITY ${APP_VERSION}`
  }, [])

  // ---- Pointer Lock の状態を追跡 ----
  useEffect(() => {
    const onChange = () => setLocked(!!document.pointerLockElement)
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [])

  // ---- 経過時間 ----
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100)
    return () => clearInterval(id)
  }, [playing, startedAt])

  // ---- スコア記録関数（エンドレスタイマーより前に定義する必要あり） ----
  const recordSolo = useCallback(() => {
    const variant = gameMode === 'shape' ? difficulty : mode.id
    const s = statsRef.current
    const score = computeSoloScore(gameMode, variant, s)
    const detail =
      gameMode === 'shape'
        ? `${s.timeSec.toFixed(1)}s・ワープ${s.warps}・ミス${s.mistakes}`
        : `${s.timeSec.toFixed(1)}s`
    const key = categoryKey('solo', gameMode, variant)
    setNameInput(getPlayerName())
    setPending({
      key,
      score,
      detail,
      isEndless: false,
      ranked: wouldRank(key, score),
      saved: false,
      rank: -1,
    })
  }, [gameMode, difficulty, mode.id])

  const recordEndless = useCallback(
    (cleared: number) => {
      const variant = gameMode === 'shape' ? difficulty : mode.id
      const key = categoryKey('endless', gameMode, variant)
      const detail = new Date().toLocaleDateString('ja-JP')
      setNameInput(getPlayerName())
      setPending({
        key,
        score: cleared,
        detail,
        isEndless: true,
        ranked: wouldRank(key, cleared),
        saved: false,
        rank: -1,
      })
    },
    [gameMode, difficulty, mode.id],
  )

  // ---- エンドレス: 残り時間カウントダウン ----
  const endlessActive = playing && gameType === 'endless' && gameMode !== 'image'
  useEffect(() => {
    if (!endlessActive) return
    const id = setInterval(() => {
      const left = (deadlineRef.current - Date.now()) / 1000
      if (left <= 0) {
        setEndlessLeft(0)
        if (document.pointerLockElement) document.exitPointerLock()
        recordEndless(clearedRef.current)
        setPhase('ENDLESS_OVER')
      } else {
        // 残りわずかで毎秒カウントダウン音
        if (left <= 5) {
          const sec = Math.ceil(left)
          if (sec !== lastTickRef.current) {
            lastTickRef.current = sec
            audio.warnTick()
          }
        }
        setEndlessLeft(left)
      }
    }, 100)
    return () => clearInterval(id)
  }, [endlessActive, recordEndless])

  // ---- エンドレス: 時間増減フラッシュの自動消去 ----
  useEffect(() => {
    if (!bonusFlash) return
    const id = setTimeout(() => setBonusFlash(null), 1000)
    return () => clearTimeout(id)
  }, [bonusFlash])

  // ---- 初回クリックを検出（操作ヒントの表示制御） ----
  useEffect(() => {
    if (!playing) return
    const onDown = () => setInteracted(true)
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [playing])

  // ---- トーストの自動消去 ----
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(id)
  }, [toast])

  // ---- Enter で回答モードへ（Pointer Lock を解除。アルファベットは入力欄へ） ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!playing || e.key !== 'Enter') return
      const el = e.target as HTMLElement | null
      if (el && el.tagName === 'INPUT') return // 入力欄の Enter は submit 側で処理
      if (document.pointerLockElement) document.exitPointerLock()
      if (gameMode === 'alphabet') {
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, gameMode])

  // ---- 画像アップロード ----
  const addImages = useCallback((files: FileList | null) => {
    if (!files) return
    const added: UserImage[] = []
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      added.push({ id: imageIdRef.current++, url: URL.createObjectURL(f), name: f.name })
    }
    if (added.length) setImages((prev) => [...prev, ...added])
  }, [])

  const clearImages = useCallback(() => {
    setImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.url))
      return []
    })
  }, [])

  // ---- ゲーム開始 ----
  // 現在の設定で新しいお題（stage）を生成。副作用として shape のパズル状態も更新
  const makeStage = useCallback((): Stage => {
    if (gameMode === 'shape') {
      const def =
        difficulty === 'random' ? pickAnyPuzzle(Math.random) : pickPuzzle(difficulty, Math.random)
      setShapePuzzle(def)
      setShapeHud({ placed: 0, total: def.slots.length, markedDesc: null })
      return { kind: 'shape', puzzleId: def.id, difficulty }
    }
    return { kind: 'alphabet', letter: randomLetter() }
  }, [gameMode, difficulty])

  const startGame = useCallback(
    (m: SizeMode) => {
      const endless = gameType === 'endless' && gameMode !== 'image'
      if (gameMode === 'image') {
        if (images.length < 4) return
        const target = images[Math.floor(Math.random() * images.length)]
        const distractors = shuffle(images.filter((i) => i.id !== target.id)).slice(0, 3)
        setTargetImage(target)
        setChoices(shuffle([target, ...distractors]))
        setStage({ kind: 'image', url: target.url })
      } else if (gameMode === 'shape') {
        const def =
          difficulty === 'random' ? pickAnyPuzzle(Math.random) : pickPuzzle(difficulty, Math.random)
        setShapePuzzle(def)
        setShapeHud({ placed: 0, total: def.slots.length, markedDesc: null })
        setStage({ kind: 'shape', puzzleId: def.id, difficulty })
      } else {
        setStage({ kind: 'alphabet', letter: randomLetter() })
      }
      setMode(m)
      setAnswer('')
      setInteracted(false)
      setToast(null)
      statsRef.current = { ...EMPTY_STATS }
      setRunId((id) => id + 1)
      setStartedAt(Date.now())
      setElapsed(0)
      // エンドレス初期化
      if (endless) {
        const t = endlessTiming(gameMode, gameMode === 'shape' ? difficulty : m.id)
        deadlineRef.current = Date.now() + t.initial * 1000
        setEndlessLeft(t.initial)
        setEndlessCleared(0)
        clearedRef.current = 0
        setBonusFlash(null)
      }
      audio.ensureAudio()
      audio.startAmbient()
      clearInput()
      setPhase('PLAYING')
    },
    [gameMode, images, difficulty, gameType],
  )

  // エンドレス: 次の問題へ（タイマーは維持）
  const nextEndlessQuestion = useCallback(() => {
    setStage(makeStage())
    setAnswer('')
    setInteracted(false)
    setToast(null)
    statsRef.current = { ...EMPTY_STATS }
    setRunId((id) => id + 1)
    setStartedAt(Date.now())
  }, [makeStage])

  // エンドレス: 1問クリア（時間追加＋次の問題）
  const endlessClear = useCallback(() => {
    const t = endlessTiming(gameMode, gameMode === 'shape' ? difficulty : mode.id)
    deadlineRef.current += t.bonus * 1000
    clearedRef.current += 1
    setEndlessCleared((c) => c + 1)
    bonusKey.current += 1
    setBonusFlash({ text: `+${t.bonus}s`, key: bonusKey.current })
    audio.bonus()
    nextEndlessQuestion()
  }, [gameMode, difficulty, mode.id, nextEndlessQuestion])

  // ---- 回答/終了 ----
  const finish = useCallback(
    (correct: boolean) => {
      if (document.pointerLockElement) document.exitPointerLock()
      const t = (Date.now() - startedAt) / 1000
      statsRef.current.timeSec = t
      setFinalTime(t)
      if (correct) audio.correct()
      else audio.wrong()
      // 正解は「正解発表モード」を挟んでからリザルト、不正解は直接リザルト
      setPhase(correct ? 'REVEAL' : 'FAILED')
    },
    [startedAt],
  )

  const submitLetter = useCallback(() => {
    const guess = answer.trim().toUpperCase()
    if (!/^[A-Z]$/.test(guess) || stage.kind !== 'alphabet') return
    const correct = guess === stage.letter
    if (gameType === 'endless') {
      if (correct) {
        endlessClear()
      } else {
        const t = endlessTiming('alphabet', mode.id)
        deadlineRef.current -= t.penalty * 1000
        bonusKey.current += 1
        setBonusFlash({ text: `-${t.penalty}s`, key: bonusKey.current })
        audio.wrong()
        nextEndlessQuestion()
      }
      return
    }
    finish(correct)
  }, [answer, stage, finish, gameType, endlessClear, mode.id, nextEndlessQuestion])

  const submitImage = useCallback(
    (img: UserImage) => {
      if (!targetImage) return
      finish(img.id === targetImage.id)
    },
    [targetImage, finish],
  )

  // ---- 図形モードのコールバック ----
  const handleShapeMessage = useCallback((msg: ShapeMessage) => {
    // 効果音
    if (msg === 'MARKED' || msg === 'REMARKED') audio.mark()
    else if (msg === 'MARK_CLEARED') audio.unmark()
    else if (msg === 'CONNECTED') audio.connect()
    else if (
      msg === 'WRONG_PIECE' || msg === 'WRONG_FACE' || msg === 'OUTER_FACE' ||
      msg === 'OCCUPIED' || msg === 'NO_FIRST_FIT' || msg === 'NEED_CLUSTER' ||
      msg === 'BOTH_PLACED' || msg === 'TOP_FACE'
    ) audio.wrong()
    const m = SHAPE_MESSAGES[msg]
    if (!m) return
    toastKey.current += 1
    setToast({ text: m.text, kind: m.kind, key: toastKey.current })
  }, [])

  const handleShapeHud = useCallback((hud: ShapeHud) => setShapeHud(hud), [])

  const handleShapeComplete = useCallback(() => {
    if (gameType === 'endless') {
      endlessClear()
      return
    }
    // 完成の余韻を見せてからリザルトへ
    setTimeout(() => finish(true), 900)
  }, [finish, gameType, endlessClear])

  const backToMenu = useCallback(() => {
    if (document.pointerLockElement) document.exitPointerLock()
    audio.stopAmbient()
    setPending(null)
    setPhase('START')
  }, [])

  const saveScore = useCallback(() => {
    if (!pending) return
    const name = nameInput.trim().slice(0, 12) || '名無し'
    setPlayerName(name)
    const rank = addScore(pending.key, {
      name,
      score: pending.score,
      detail: pending.detail,
      date: Date.now(),
    })
    setPending({ ...pending, saved: true, rank })
  }, [pending, nameInput])

  const [x, y, z] = debugPos
  const handleDebug = useCallback((pos: Vector3) => {
    setDebugPos([pos.x, pos.y, pos.z])
  }, [])

  const canStart = gameMode !== 'image' || images.length >= 4

  const easyShapes = PUZZLES.filter((p) => p.difficulty === 'easy')
  const hardShapes = PUZZLES.filter((p) => p.difficulty === 'hard')

  // リザルトのスコア・名前入力・順位表示（ソロ/エンドレス共通）
  const scoreEntry = pending ? (
    <div className="score-entry">
      {!pending.isEndless && (
        <div className="score-value">
          SCORE <strong>{pending.score.toLocaleString()}</strong>
        </div>
      )}
      {pending.saved ? (
        <p className="score-rank">
          {pending.rank > 0 ? (
            <>
              <span className="rank-badge">{pending.rank}位</span> にランクイン！
            </>
          ) : (
            'ランキング圏外でした'
          )}
        </p>
      ) : pending.ranked ? (
        <div className="name-entry">
          <p className="name-entry-label">🏆 ランキング入り！ 名前を登録</p>
          <div className="name-entry-row">
            <input
              value={nameInput}
              maxLength={12}
              placeholder="名前"
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveScore()
              }}
            />
            <button onClick={saveScore}>登録</button>
          </div>
        </div>
      ) : (
        <p className="score-rank dim">ランキング圏外</p>
      )}
    </div>
  ) : null

  return (
    <div className="app">
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showRanking && <RankingScreen onClose={() => setShowRanking(false)} />}

      {phase !== 'START' && (
        <GameScene
          key={runId} // ラウンドごとにシーンを作り直す
          stage={stage}
          scale={mode.scale}
          active={playing}
          runId={runId}
          reveal={phase === 'REVEAL'}
          statsRef={statsRef}
          onDebug={handleDebug}
          onShapeMessage={handleShapeMessage}
          onShapeHud={handleShapeHud}
          onShapeComplete={handleShapeComplete}
        />
      )}

      {/* ================= メニュー ================= */}
      {phase === 'START' && (
        <div className="menu">
          <div className="menu-inner">
            <p className="menu-eyebrow">FIRST-PERSON GRAVITY PUZZLE</p>
            <p className="menu-version">{APP_VERSION}</p>
            <div className="menu-topbar">
              <button className="gear-btn" onClick={() => setShowRanking(true)} aria-label="ランキング">
                🏆 ランキング
              </button>
              <button className="gear-btn" onClick={() => setShowSettings(true)} aria-label="設定">
                ⚙ 設定
              </button>
            </div>
            <h1 className="menu-title">
              ALPHA<span>GRAVITY</span>
            </h1>

            <div className="mode-tabs">
              <button
                className={gameMode === 'alphabet' ? 'active' : ''}
                onClick={() => setGameMode('alphabet')}
              >
                アルファベット
              </button>
              <button
                className={gameMode === 'image' ? 'active' : ''}
                onClick={() => {
                  setGameMode('image')
                  setGameType('solo')
                }}
              >
                画像
              </button>
              <button
                className={gameMode === 'shape' ? 'active' : ''}
                onClick={() => setGameMode('shape')}
              >
                図形
              </button>
            </div>

            {/* ゲーム種別（画像モードはソロのみ） */}
            {gameMode !== 'image' && (
              <div className="type-tabs">
                <button
                  className={gameType === 'solo' ? 'active' : ''}
                  onClick={() => setGameType('solo')}
                >
                  1問チャレンジ
                </button>
                <button
                  className={gameType === 'endless' ? 'active' : ''}
                  onClick={() => setGameType('endless')}
                >
                  ⏱ エンドレス
                </button>
              </div>
            )}

            {gameType === 'endless' && gameMode !== 'image' && (
              <p className="endless-note">
                制限時間内に解き続けろ。1問クリアで時間が増える。時間切れまでの<strong>クリア数</strong>を競う。
              </p>
            )}

            {gameMode === 'alphabet' && (
              <p className="menu-desc">
                巨大なアルファベットの上に降り立った。
                <br />
                表面を歩き回り、これが<strong>何の文字か</strong>を当てろ。
              </p>
            )}

            {gameMode === 'image' && (
              <>
                <p className="menu-desc">
                  画像を<strong>4枚以上</strong>入れろ。そのうち1枚が巨大な床になる。
                  <br />
                  上を歩き回り、<strong>どの画像の上にいるか</strong>を4択で当てろ。
                </p>
                <div className="uploader">
                  <label className="upload-btn">
                    画像を追加
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        addImages(e.target.files)
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {images.length > 0 && (
                    <button className="clear-btn" onClick={clearImages}>
                      全消去
                    </button>
                  )}
                  <span className={`upload-count ${images.length >= 4 ? 'ok' : ''}`}>
                    {images.length} / 4枚以上
                  </span>
                </div>
                {images.length > 0 && (
                  <div className="thumb-row">
                    {images.map((img) => (
                      <img key={img.id} src={img.url} alt={img.name} title={img.name} />
                    ))}
                  </div>
                )}
              </>
            )}

            {gameMode === 'shape' && (
              <p className="menu-desc">
                バラバラのピースが宇宙に散らばっている。
                <br />
                クリックでピースを渡り歩き、<strong>面と面をくっつけてお題の図形</strong>を作れ。
              </p>
            )}

            {/* 図形モードは難易度、それ以外はサイズ */}
            {gameMode === 'shape' ? (
              <>
                <p className="menu-label">── 難易度 ──</p>
                <div className="size-row">
                  <button
                    className={`size-btn ${difficulty === 'easy' ? 'selected' : ''}`}
                    onClick={() => setDifficulty('easy')}
                  >
                    <span className="size-name">イージー</span>
                    <span className="size-sub">同じピース・自由に組める</span>
                  </button>
                  <button
                    className={`size-btn ${difficulty === 'hard' ? 'selected' : ''}`}
                    onClick={() => setDifficulty('hard')}
                  >
                    <span className="size-name">ハード</span>
                    <span className="size-sub">形バラバラ・組み方は厳密</span>
                  </button>
                  <button
                    className={`size-btn ${difficulty === 'random' ? 'selected' : ''}`}
                    onClick={() => setDifficulty('random')}
                  >
                    <span className="size-name">ランダム</span>
                    <span className="size-sub">全図形からランダム出題</span>
                  </button>
                </div>
                <p className="menu-label">── 出題される図形 ──</p>
                <div className="silhouette-row">
                  {(difficulty === 'easy'
                    ? easyShapes
                    : difficulty === 'hard'
                      ? hardShapes
                      : PUZZLES
                  ).map((p) => (
                    <div key={p.id} className="silhouette-card">
                      <ShapeSilhouette def={p} size={64} />
                      <span>{p.name}</span>
                    </div>
                  ))}
                </div>
                <p className="start-note dim">
                  {difficulty === 'random'
                    ? '全図形からランダムで1問出題されます（お題は表示されます）'
                    : 'この中からランダムで1問出題されます'}
                </p>
              </>
            ) : (
              <>
                <p className="menu-label">── 土台のサイズ ──</p>
                <div className="size-row">
                  {SIZE_MODES.map((m) => (
                    <button
                      key={m.id}
                      className={`size-btn ${mode.id === m.id ? 'selected' : ''}`}
                      onClick={() => setMode(m)}
                    >
                      <span className="size-name">{m.label}</span>
                      <span className="size-sub">{m.sub}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <button className="start-btn" disabled={!canStart} onClick={() => startGame(mode)}>
              ゲーム開始
            </button>
            {gameMode === 'image' && !canStart && (
              <p className="start-note">あと{4 - images.length}枚追加でスタートできます</p>
            )}

            <div className="menu-controls">
              {gameMode === 'shape' ? (
                <>
                  <span>W/A/S/D 移動</span>
                  <span>クリック ワープ</span>
                  <span>F 見た面をマーク/接続</span>
                  <span>X マーク解除</span>
                  <span>R リスポーン</span>
                </>
              ) : (
                <>
                  <span>W/A/S/D 移動</span>
                  <span>マウス 視点</span>
                  <span>Shift ダッシュ</span>
                  <span>Enter 回答</span>
                  <span>R リスポーン</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= HUD（ゲーム中） ================= */}
      {playing && (
        <>
          <button
            className="gear-btn ingame-gear"
            onClick={() => setShowSettings(true)}
            aria-label="設定"
          >
            ⚙
          </button>
          {(locked || interacted) && <div className="reticle" aria-hidden="true" />}

          {endlessActive &&
            (() => {
              const t = endlessTiming(gameMode, gameMode === 'shape' ? difficulty : mode.id)
              const pct = Math.max(0, Math.min(100, (endlessLeft / t.initial) * 100))
              const low = endlessLeft <= 5
              return (
                <div className="endless-hud">
                  <div className="endless-top">
                    <span className="endless-count">クリア {endlessCleared}</span>
                    <span className={`endless-time ${low ? 'low' : ''}`}>
                      {endlessLeft.toFixed(1)}s
                    </span>
                  </div>
                  <div className="endless-bar">
                    <div
                      className={`endless-bar-fill ${low ? 'low' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {bonusFlash && (
                    <div
                      key={bonusFlash.key}
                      className={`bonus-flash ${bonusFlash.text.startsWith('-') ? 'minus' : ''}`}
                    >
                      {bonusFlash.text}
                    </div>
                  )}
                </div>
              )
            })()}

          {!locked && !interacted && (
            <div className="lock-hint">
              <p>画面をクリックして操作開始</p>
              <p className="lock-sub">
                {stage.kind === 'shape'
                  ? 'マウスで視点 / クリックでワープ / 見ている面を F でマーク'
                  : 'マウス操作が固定されない環境ではドラッグで視点移動 / Enter で回答モード'}
              </p>
            </div>
          )}

          <div className="hud-debug">
            <div>BUILD: {APP_VERSION}</div>
            <div>
              MODE: {stage.kind === 'shape' ? `図形 (${difficulty === 'easy' ? 'イージー' : difficulty === 'hard' ? 'ハード' : 'ランダム'})` : `${mode.label} (${mode.sub})`}
            </div>
            <div>
              POS: {x.toFixed(1)} / {y.toFixed(1)} / {z.toFixed(1)}
            </div>
            <div>TIME: {elapsed.toFixed(1)}s</div>
          </div>

          {/* ---- アルファベット/画像モード ---- */}
          {stage.kind === 'alphabet' && (
            <>
              <div className="hud-controls">
                W/A/S/D 移動 / マウス 視点 / Shift ダッシュ / M 足跡 / R リスポーン
              </div>
              <div className="hud-answer">
                <input
                  ref={inputRef}
                  value={answer}
                  maxLength={1}
                  placeholder="?"
                  onChange={(e) =>
                    setAnswer(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitLetter()
                    if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
                  }}
                />
                <button onClick={submitLetter} disabled={!/^[A-Z]$/.test(answer)}>
                  回答
                </button>
              </div>
            </>
          )}

          {stage.kind === 'image' && (
            <>
              <div className="hud-controls">
                W/A/S/D 移動 / マウス 視点 / Shift ダッシュ / M 足跡 / R リスポーン
              </div>
              <div className="hud-choices">
                <p className="hud-choices-label">どの画像の上にいる？（Enterでマウス解放）</p>
                <div className="hud-choices-row">
                  {choices.map((img) => (
                    <button key={img.id} onClick={() => submitImage(img)}>
                      <img src={img.url} alt={img.name} />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ---- 図形モード ---- */}
          {stage.kind === 'shape' && shapePuzzle && (
            <>
              {/* お題プレビュー（常時表示） */}
              <div className="shape-goal">
                <ShapeSilhouette def={shapePuzzle} size={72} />
                <div className="shape-goal-info">
                  <span className="shape-goal-name">お題: {shapePuzzle.name}</span>
                  <span className="shape-goal-progress">
                    {shapeHud.placed} / {shapeHud.total} ピース接続
                  </span>
                  {shapeHud.markedDesc && (
                    <span className="shape-goal-mark">◉ {shapeHud.markedDesc}</span>
                  )}
                </div>
              </div>

              <div className="hud-controls">
                クリック ワープ / 見ている面を F でマーク→接続 / X 解除 / M 足跡 / R リスポーン
              </div>

              <button className="giveup-btn" onClick={backToMenu}>
                ギブアップ
              </button>
            </>
          )}

          {/* トースト（図形モードの操作フィードバック） */}
          {toast && (
            <div key={toast.key} className={`toast toast-${toast.kind}`}>
              {toast.text}
            </div>
          )}
        </>
      )}

      {/* ================= 正解発表モード ================= */}
      {phase === 'REVEAL' && (
        <div
          className="reveal-overlay"
          onClick={() => {
            recordSolo()
            setPhase('SUCCESS')
          }}
        >
          <div className="reveal-hint">クリックして結果を見る</div>
        </div>
      )}

      {/* ================= エンドレス結果 ================= */}
      {phase === 'ENDLESS_OVER' && (
        <div className="result endless-over">
          <div className="result-inner">
            <p className="result-head">タイムアップ！</p>
            <div className="endless-score">{endlessCleared}</div>
            <p className="result-detail">問クリア</p>
            {scoreEntry}
            <div className="result-btns">
              <button className="primary" onClick={() => startGame(mode)}>
                もう一度
              </button>
              <button onClick={backToMenu}>メニューへ</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= リザルト ================= */}
      {(phase === 'SUCCESS' || phase === 'FAILED') && (
        <div className={`result ${phase === 'SUCCESS' ? 'success' : 'failed'}`}>
          <div className="result-inner">
            <p className="result-head">{phase === 'SUCCESS' ? '正解！' : '不正解…'}</p>
            {stage.kind === 'alphabet' && <div className="result-letter">{stage.letter}</div>}
            {stage.kind === 'image' && targetImage && (
              <img className="result-image" src={targetImage.url} alt={targetImage.name} />
            )}
            {stage.kind === 'shape' && shapePuzzle && (
              <div className="result-shape">
                <ShapeSilhouette def={shapePuzzle} size={140} />
                <span>{shapePuzzle.name}</span>
              </div>
            )}
            <p className="result-detail">
              {phase === 'SUCCESS'
                ? `クリアタイム ${finalTime.toFixed(1)} 秒`
                : stage.kind === 'alphabet'
                  ? `正解は「${stage.letter}」でした`
                  : stage.kind === 'image'
                    ? 'この画像の上にいました'
                    : 'お題の図形'}
            </p>
            {phase === 'SUCCESS' && scoreEntry}
            <div className="result-btns">
              <button className="primary" onClick={() => startGame(mode)}>
                {phase === 'SUCCESS' ? 'もう一度遊ぶ' : 'リトライ'}
              </button>
              <button onClick={backToMenu}>メニューへ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
