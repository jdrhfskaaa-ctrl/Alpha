import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  SETTINGS_RANGES,
  getSettings,
  resetSettings,
  setSettings,
  subscribeSettings,
  type Settings,
} from './settings'

interface SettingsPanelProps {
  onClose: () => void
}

/** スライダー行 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="set-row">
      <div className="set-row-head">
        <span>{label}</span>
        <span className="set-val">
          {step < 1 ? value.toFixed(2) : value}
          {suffix ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [s, setS] = useState<Settings>(getSettings())
  useEffect(() => subscribeSettings(setS), [])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>設定</h2>
          <button className="settings-close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>

        <p className="settings-section">操作・視点</p>
        <Slider
          label="視野角 (FOV)"
          value={s.fov}
          {...SETTINGS_RANGES.fov}
          suffix="°"
          onChange={(v) => setSettings({ fov: v })}
        />
        <Slider
          label="マウス感度"
          value={s.sensitivity}
          {...SETTINGS_RANGES.sensitivity}
          onChange={(v) => setSettings({ sensitivity: v })}
        />
        <div className="set-row set-toggle">
          <span>上下反転</span>
          <button
            className={s.invertY ? 'on' : ''}
            onClick={() => setSettings({ invertY: s.invertY ? 0 : 1 })}
          >
            {s.invertY ? 'ON' : 'OFF'}
          </button>
        </div>

        <p className="settings-section">酔い対策</p>
        <Slider
          label="重力再配向の機敏さ"
          value={s.reorientSmooth}
          {...SETTINGS_RANGES.reorientSmooth}
          onChange={(v) => setSettings({ reorientSmooth: v })}
        />
        <p className="settings-hint">
          小さくすると面が変わるときの回転が緩やかになり、3D酔いしにくくなります。
        </p>

        <p className="settings-section">サウンド</p>
        <Slider
          label="音量"
          value={s.volume}
          {...SETTINGS_RANGES.volume}
          onChange={(v) => setSettings({ volume: v })}
        />
        <div className="set-row set-toggle">
          <span>ミュート</span>
          <button
            className={s.muted ? 'on' : ''}
            onClick={() => setSettings({ muted: s.muted ? 0 : 1 })}
          >
            {s.muted ? 'ON' : 'OFF'}
          </button>
        </div>

        <button
          className="settings-reset"
          onClick={() => {
            if (confirm('設定を初期値に戻しますか？')) resetSettings()
          }}
        >
          初期設定に戻す
        </button>
        <p className="settings-hint dim">既定: FOV {DEFAULT_SETTINGS.fov}° / 感度 1.00</p>
      </div>
    </div>
  )
}
