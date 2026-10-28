import type { Preferences } from "../core/profile";
import { OfflineStatus, type OfflineState } from "../offline";
interface Props {
  preferences: Preferences;
  onPreference: <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => void;
  offline: OfflineState;
  notice: string;
  onRefresh: () => void;
}
export function SettingsPanel({
  preferences: p,
  onPreference: change,
  offline,
  notice,
  onRefresh,
}: Props) {
  const toggle = (label: string, value: boolean, action: () => void) => (
    <div className="setting-row">
      <span>{label}</span>
      <button
        role="switch"
        aria-label={label}
        aria-checked={value}
        className={"switch " + (value ? "checked" : "")}
        onClick={action}
      >
        <span />
      </button>
    </div>
  );
  return (
    <div className="settings-panel settings-single">
      <span className="setting-label">Appearance</span>
      <div className="theme-picker" role="group" aria-label="Appearance">
        {(["light", "dark", "system"] as const).map((theme) => (
          <button
            key={theme}
            aria-pressed={p.theme === theme}
            onClick={() => change("theme", theme)}
          >
            {theme[0].toUpperCase() + theme.slice(1)}
          </button>
        ))}
      </div>
      {toggle("Reduce motion", p.reduceMotion, () =>
        change("reduceMotion", !p.reduceMotion),
      )}
      {toggle("Sound effects", p.effects, () => change("effects", !p.effects))}
      <label className="volume-row">
        <span>
          Effects volume<output>{Math.round(p.effectsVolume * 100)}%</output>
        </span>
        <input
          aria-label="Effects volume"
          type="range"
          min="0"
          max="1"
          step=".01"
          value={p.effectsVolume}
          onChange={(e) => change("effectsVolume", Number(e.target.value))}
        />
      </label>
      <div className="settings-footer">
        <OfflineStatus offline={offline} onRefresh={onRefresh} />
        <p className="setting-hint">
          Progress and statistics stay on this device.
        </p>
        {(notice || offline.error) && (
          <p role="alert">{notice || offline.error}</p>
        )}
      </div>
    </div>
  );
}
