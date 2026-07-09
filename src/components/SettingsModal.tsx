import { useState, useEffect } from 'react';
import { useStore } from '../state/store';
import {
  getSecrets, setSecret, deleteSecret,
  getPersona, updatePersona, resetPersona,
  getPrompts, updatePrompts, resetPrompts,
  getProgress, resetProgress,
  getModels, type SecretStatus, type Model,
} from '../api/client';

export default function SettingsModal() {
  const {
    settingsTab, setSettingsTab, setSettingsOpen,
    setProgress, setModels, setModel, currentModel,
  } = useStore();

  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
  const [personaFiles, setPersonaFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [selectedPrompt, setSelectedPrompt] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [models, setModelsList] = useState<Model[]>([]);
  const [scoutModel, setScoutModel] = useState('');
  const [forgeModel, setForgeModel] = useState('');

  useEffect(() => {
    loadTab();
  }, [settingsTab]);

  const loadTab = async () => {
    try {
      if (settingsTab === 'api-keys') {
        const res = await getSecrets();
        setSecrets(res.secrets);
      } else if (settingsTab === 'persona') {
        const res = await getPersona();
        setPersonaFiles(res.contents);
        const files = Object.keys(res.contents);
        if (files.length > 0 && !selectedFile) {
          setSelectedFile(files[0]);
          setFileContent(res.contents[files[0]] || '');
        }
      } else if (settingsTab === 'prompts') {
        const res = await getPrompts();
        setPrompts(res.prompts);
        const keys = Object.keys(res.prompts);
        if (keys.length > 0 && !selectedPrompt) {
          setSelectedPrompt(keys[0]);
          setPromptContent(res.prompts[keys[0]] || '');
        }
      } else if (settingsTab === 'models') {
        const res = await getModels();
        setModelsList(res.models);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  };

  const handleSaveSecret = async (key: string) => {
    const value = secretInputs[key];
    if (!value) return;
    try {
      await setSecret(key, value);
      setSecretInputs((prev) => ({ ...prev, [key]: '' }));
      const res = await getSecrets();
      setSecrets(res.secrets);
    } catch (err) {
      console.error('Failed to save secret:', err);
    }
  };

  const handleClearSecret = async (key: string) => {
    try {
      await deleteSecret(key);
      const res = await getSecrets();
      setSecrets(res.secrets);
    } catch (err) {
      console.error('Failed to clear secret:', err);
    }
  };

  const handleSavePersona = async () => {
    if (!selectedFile) return;
    try {
      await updatePersona(selectedFile, fileContent);
      setPersonaFiles((prev) => ({ ...prev, [selectedFile]: fileContent }));
    } catch (err) {
      console.error('Failed to save persona:', err);
    }
  };

  const handleResetPersona = async () => {
    try {
      await resetPersona();
      const res = await getPersona();
      setPersonaFiles(res.contents);
    } catch (err) {
      console.error('Failed to reset persona:', err);
    }
  };

  const handleSavePrompt = async () => {
    if (!selectedPrompt) return;
    try {
      await updatePrompts({ [selectedPrompt]: promptContent });
      setPrompts((prev) => ({ ...prev, [selectedPrompt]: promptContent }));
    } catch (err) {
      console.error('Failed to save prompt:', err);
    }
  };

  const handleResetPrompts = async () => {
    try {
      await resetPrompts();
      const res = await getPrompts();
      setPrompts(res.prompts);
    } catch (err) {
      console.error('Failed to reset prompts:', err);
    }
  };

  const handleResetProgress = async () => {
    try {
      await resetProgress();
      const p = await getProgress();
      setProgress(p);
    } catch (err) {
      console.error('Failed to reset progress:', err);
    }
  };

  const tabs = [
    { id: 'api-keys', label: 'API Keys' },
    { id: 'models', label: 'Models' },
    { id: 'persona', label: 'Persona' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'progress', label: 'Progress' },
  ];

  return (
    <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
      <div className="modal" style={{ width: '650px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)}>x</button>
        </div>
        <div className="tab-bar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab ${settingsTab === tab.id ? 'active' : ''}`}
              onClick={() => setSettingsTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {/* API Keys */}
          {settingsTab === 'api-keys' && (
            <div>
              <p className="settings-section-desc">
                Configure API keys for LLM providers. Keys are stored locally.
              </p>
              {secrets.map((s) => (
                <div key={s.key} className="form-group">
                  <label className="form-label">
                    {s.key.replace('_API_KEY', '')}
                    {s.configured && (
                      <span className="status-ok">configured</span>
                    )}
                  </label>
                  <div className="input-row">
                    <input
                      className="form-input"
                      type="password"
                      placeholder={s.configured ? s.preview || '***configured***' : 'Enter API key...'}
                      value={secretInputs[s.key] || ''}
                      onChange={(e) => setSecretInputs((prev) => ({ ...prev, [s.key]: e.target.value }))}
                    />
                    <button className="btn btn-primary" onClick={() => handleSaveSecret(s.key)}>
                      Save
                    </button>
                    {s.configured && (
                      <button className="btn btn-danger" onClick={() => handleClearSecret(s.key)}>
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="settings-help">
                <p>Get OpenRouter key at: openrouter.ai/keys</p>
                <p>Get Gemini key at: aistudio.google.com/apikey</p>
              </div>
            </div>
          )}

          {/* Models */}
          {settingsTab === 'models' && (
            <div>
              <p className="settings-section-desc">
                Select which models Manus and the Forge use.
              </p>
              <div className="form-group">
                <label className="form-label">Scout (Chat) Model</label>
                <select
                  className="form-input"
                  value={currentModel}
                  onChange={(e) => { setModel(e.target.value); setScoutModel(e.target.value); }}
                >
                  {models.length === 0 && <option value="">No models available - add API keys first</option>}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Forge (Code Generation) Model</label>
                <select
                  className="form-input"
                  value={forgeModel}
                  onChange={(e) => setForgeModel(e.target.value)}
                >
                  {models.length === 0 && <option value="">No models available</option>}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                  ))}
                </select>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px' }}>
                The Forge model generates Python code for new skills. A capable model works best.
              </p>
            </div>
          )}

          {/* Persona */}
          {settingsTab === 'persona' && (
            <div>
              <p className="settings-section-desc">
                Edit persona files that shape Manus's personality and memory.
              </p>
              <div className="persona-tabs">
                {Object.keys(personaFiles).map((name) => (
                  <button
                    key={name}
                    className={`tab ${selectedFile === name ? 'active' : ''}`}
                    onClick={() => { setSelectedFile(name); setFileContent(personaFiles[name] || ''); }}
                  >
                    {name.replace('.md', '')}
                  </button>
                ))}
              </div>
              <textarea
                className="form-input persona-editor"
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
              />
              <div className="input-row" style={{ marginTop: '12px' }}>
                <button className="btn btn-primary" onClick={handleSavePersona}>Save</button>
                <button className="btn btn-danger" onClick={handleResetPersona}>Reset All</button>
              </div>
            </div>
          )}

          {/* Prompts */}
          {settingsTab === 'prompts' && (
            <div>
              <p className="settings-section-desc">
                Customize system prompts used for Scout and Forge.
              </p>
              <div className="persona-tabs">
                {Object.keys(prompts).map((key) => (
                  <button
                    key={key}
                    className={`tab ${selectedPrompt === key ? 'active' : ''}`}
                    onClick={() => { setSelectedPrompt(key); setPromptContent(prompts[key] || ''); }}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <textarea
                className="form-input persona-editor"
                value={promptContent}
                onChange={(e) => setPromptContent(e.target.value)}
              />
              <div className="input-row" style={{ marginTop: '12px' }}>
                <button className="btn btn-primary" onClick={handleSavePrompt}>Save</button>
                <button className="btn btn-danger" onClick={handleResetPrompts}>Reset All</button>
              </div>
            </div>
          )}

          {/* Progress */}
          {settingsTab === 'progress' && (
            <div>
              <p className="settings-section-desc">
                Manage your gamification progress and data.
              </p>
              <div className="progress-info">
                <div className="progress-info-item">
                  <span>Level</span>
                  <span className="progress-info-value">{useStore.getState().progress?.level || 1}</span>
                </div>
                <div className="progress-info-item">
                  <span>XP</span>
                  <span className="progress-info-value">{useStore.getState().progress?.xp || 0}</span>
                </div>
                <div className="progress-info-item">
                  <span>Skills Unlocked</span>
                  <span className="progress-info-value">{useStore.getState().progress?.skills_unlocked || 0}</span>
                </div>
                <div className="progress-info-item">
                  <span>Chats</span>
                  <span className="progress-info-value">{useStore.getState().progress?.chat_count || 0}</span>
                </div>
              </div>
              <div style={{ marginTop: '20px' }}>
                <button className="btn btn-danger" onClick={handleResetProgress}>
                  Reset All Progress
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
