/**
 * Web Audio による効果音・環境音の合成エンジン。
 * 音声ファイルを持たず全てその場で合成するので、単一HTMLに収まる。
 * AudioContext はユーザー操作後にしか start できないため、初回の
 * ensure() 呼び出し（クリック等の後）で遅延生成する。
 */

import { getSettings, subscribeSettings } from './settings'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let ambientGain: GainNode | null = null
let ambientNodes: (OscillatorNode | AudioBufferSourceNode)[] = []
let started = false

function applyVolume() {
  if (!master || !ctx) return
  const s = getSettings()
  const v = s.muted ? 0 : s.volume
  master.gain.setTargetAtTime(v, ctx.currentTime, 0.02)
}

/** 初回のユーザー操作後に呼ぶ。以降は何度呼んでも安全 */
export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return
  }
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new AC()
    master = ctx.createGain()
    master.connect(ctx.destination)
    applyVolume()
    subscribeSettings(applyVolume)
  } catch {
    ctx = null
  }
}

function now(): number {
  return ctx ? ctx.currentTime : 0
}

/** 単発トーン（エンベロープ付き） */
function tone(
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  opts: { delay?: number; freqTo?: number; attack?: number } = {},
) {
  if (!ctx || !master) return
  const t0 = now() + (opts.delay ?? 0)
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (opts.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqTo), t0 + dur)
  const atk = opts.attack ?? 0.005
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + atk)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

/** フィルタ付きノイズバースト（足音・衝撃系） */
function noise(dur: number, gain: number, filterFreq: number, opts: { delay?: number } = {}) {
  if (!ctx || !master) return
  const t0 = now() + (opts.delay ?? 0)
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = filterFreq
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter)
  filter.connect(g)
  g.connect(master)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}

/** 非常に短い硬質なクリック（スイッチ・タイル用の鋭いトランジェント） */
function click(gain: number, opts: { delay?: number; hp?: number } = {}) {
  if (!ctx || !master) return
  const t0 = now() + (opts.delay ?? 0)
  const dur = 0.014
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  // 冒頭に鋭いピークを置き即減衰＝「カチッ」の芯
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = opts.hp ?? 1800
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(hp)
  hp.connect(g)
  g.connect(master)
  src.start(t0)
  src.stop(t0 + dur + 0.01)
}

// ---------------- 効果音 ----------------

let lastFootstep = 0
/** 移動中に足音を刻む。硬いタイルを踏む「タッ」。speed は実速度（0で停止） */
export function footstep(speed: number, dt: number) {
  if (!ctx || speed <= 0.1) return
  lastFootstep += dt * (0.7 + speed * 0.05)
  if (lastFootstep >= 0.4) {
    lastFootstep = 0
    // 硬い床を踏む音: 鋭いクリック + 低めのボディ + わずかな中域ノイズ
    click(0.5, { hp: 1400 })
    tone(200, 0.07, 'sine', 0.28, { freqTo: 120 })
    noise(0.05, 0.16, 1100)
  }
}

let lastReorient = 0
/** 重力再配向の「グッ」。角度が大きく変わった瞬間に */
export function reorient() {
  if (!ctx) return
  const t = now()
  if (t - lastReorient < 0.18) return
  lastReorient = t
  tone(190, 0.24, 'sine', 0.3, { freqTo: 85 })
  noise(0.16, 0.16, 320)
}

export function warp() {
  tone(880, 0.16, 'triangle', 0.24, { freqTo: 1760 })
  tone(440, 0.12, 'sine', 0.16, { freqTo: 1200, delay: 0.02 })
  click(0.3, { hp: 2400, delay: 0.02 })
}

export function mark() {
  click(0.4, { hp: 2600 })
  tone(1300, 0.06, 'square', 0.16)
}

export function unmark() {
  tone(520, 0.09, 'square', 0.14, { freqTo: 300 })
}

/** 土台接続の「カチッ！」＝スイッチを押す硬い音 */
export function connect() {
  // 押し込む瞬間の硬いトランジェント
  click(0.9, { hp: 2000 })
  tone(2600, 0.028, 'square', 0.34)
  tone(1500, 0.045, 'square', 0.24, { delay: 0.004 })
  // 「カチ」→「ッ」のリリースクリックで機械的な二段感
  click(0.55, { hp: 3200, delay: 0.075 })
  tone(2000, 0.03, 'square', 0.18, { delay: 0.075 })
  // 低い確定音でしっかり感
  tone(320, 0.12, 'sine', 0.18, { delay: 0.02, freqTo: 260 })
}

export function wrong() {
  tone(220, 0.2, 'sawtooth', 0.24, { freqTo: 150 })
  tone(160, 0.22, 'sawtooth', 0.18, { delay: 0.02 })
}

/** 正解ファンファーレ（アルペジオ） */
export function correct() {
  const notes = [523.25, 659.25, 783.99, 1046.5] // C E G C
  notes.forEach((f, i) => tone(f, 0.5, 'triangle', 0.24, { delay: i * 0.09 }))
  notes.forEach((f, i) => tone(f * 2, 0.4, 'sine', 0.09, { delay: i * 0.09 + 0.02 }))
}

/** エンドレスの時間追加（上昇ピン） */
export function bonus() {
  tone(700, 0.16, 'triangle', 0.22, { freqTo: 1400 })
  click(0.3, { hp: 2600 })
}

/** 残り時間わずかの警告 */
export function warnTick() {
  tone(1000, 0.07, 'sine', 0.2)
}

// ---------------- 環境音（宇宙の低音パッド） ----------------

export function startAmbient() {
  if (!ctx || !master || started) return
  started = true
  ambientGain = ctx.createGain()
  ambientGain.gain.value = 0.0
  ambientGain.gain.setTargetAtTime(0.1, ctx.currentTime, 2)
  ambientGain.connect(master)

  // 低音ドローン2本 + ゆっくり揺れるLFO
  const freqs = [55, 82.5]
  for (const f of freqs) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = f
    const og = ctx.createGain()
    og.gain.value = 0.5
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.06 + Math.random() * 0.05
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 0.25
    lfo.connect(lfoGain)
    lfoGain.connect(og.gain)
    osc.connect(og)
    og.connect(ambientGain)
    osc.start()
    lfo.start()
    ambientNodes.push(osc, lfo)
  }

  // かすかな高音のきらめき（フィルタノイズ）
  const len = Math.floor(ctx.sampleRate * 2)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3000
  bp.Q.value = 2
  const ng = ctx.createGain()
  ng.gain.value = 0.015
  src.connect(bp)
  bp.connect(ng)
  ng.connect(ambientGain)
  src.start()
  ambientNodes.push(src)
}

export function stopAmbient() {
  if (!ctx || !ambientGain || !started) return
  started = false
  ambientGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
  const nodes = ambientNodes
  ambientNodes = []
  const g = ambientGain
  ambientGain = null
  setTimeout(() => {
    nodes.forEach((n) => {
      try {
        n.stop()
      } catch {
        /* noop */
      }
    })
    try {
      g.disconnect()
    } catch {
      /* noop */
    }
  }, 800)
}
