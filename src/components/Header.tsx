import { useStore } from '../state/store';

export default function Header() {
  const {
    currentModel, availableModels, setModel,
    progress, tools, settingsOpen, setSettingsOpen, clearChat,
  } = useStore();

  return (
    <div className="header">
      <div className="header-left">
        <span className="header-title">ManusAgent</span>
        <div className="header-stats">
          <div className="stat-badge">
            <span className="level">Lv.{progress?.level || 1}</span>
            <div className="xp-bar-container">
              <div
                className="xp-bar"
                style={{ width: `${progress ? (progress.xp_in_level / progress.xp_to_next) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="stat-badge">
            <span className="rank">{progress?.rank || 'Initiate'}</span>
          </div>
          <div className="stat-badge">
            <span>{progress?.xp || 0} XP</span>
          </div>
          <div className="stat-badge">
            <span>{tools.length} Skills</span>
          </div>
        </div>
      </div>
      <div className="header-actions">
        <select
          className="model-select"
          value={currentModel}
          onChange={(e) => setModel(e.target.value)}
        >
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.provider})
            </option>
          ))}
        </select>
        <button className="icon-btn" onClick={clearChat} title="New Chat">
          +
        </button>
        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(!settingsOpen)}
          title="Settings"
        >
          *
        </button>
      </div>
    </div>
  );
}
