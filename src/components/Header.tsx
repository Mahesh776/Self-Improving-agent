import { useStore } from '../state/store';
import Avatar from './Avatar';

export default function Header() {
  const {
    currentModel, availableModels, setModel,
    progress, tools, settingsOpen, setSettingsOpen, clearChat,
    isStreaming,
  } = useStore();

  const xpPercent = progress ? (progress.xp_in_level / progress.xp_to_next) * 100 : 0;

  return (
    <div className="header">
      <div className="header-left">
        <Avatar isActive={isStreaming} size={32} />
        <span className="header-title">ManusAgent</span>
        <div className="header-stats">
          <div className="stat-badge" title={`Level ${progress?.level || 1}`}>
            <span className="level">Lv.{progress?.level || 1}</span>
            <div className="xp-bar-container">
              <div className="xp-bar" style={{ width: `${xpPercent}%` }} />
            </div>
          </div>
          <div className="stat-badge" title={`Rank: ${progress?.rank || 'Initiate'}`}>
            <span className="rank">{progress?.rank || 'Initiate'}</span>
          </div>
          <div className="stat-badge" title={`${progress?.xp || 0} experience points`}>
            <span>{progress?.xp || 0} XP</span>
          </div>
          <div className="stat-badge" title={`${tools.length} installed skills`}>
            <span>{tools.length} Skills</span>
          </div>
        </div>
      </div>
      <div className="header-actions">
        <select
          className="model-select"
          value={currentModel}
          onChange={(e) => setModel(e.target.value)}
          title="Select model"
        >
          {availableModels.length === 0 && (
            <option value="">No models available</option>
          )}
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button
          className="icon-btn"
          onClick={clearChat}
          title="New chat (Ctrl+Shift+N)"
          disabled={isStreaming}
        >
          +
        </button>
        <button
          className="icon-btn"
          onClick={() => setSettingsOpen(!settingsOpen)}
          title="Settings (Ctrl+,)"
        >
          *
        </button>
      </div>
    </div>
  );
}
