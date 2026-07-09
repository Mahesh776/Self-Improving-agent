import { useState, useEffect } from 'react';
import { useStore } from '../state/store';
import {
  getSecrets, setSecret, deleteSecret,
  getPersona, updatePersona, resetPersona,
  getPrompts, updatePrompts, resetPrompts,
  getProgress, resetProgress,
  type SecretStatus,
} from '../api/client';

export default function SettingsModal() {
  const { settingsTab, setSettingsTab, setSettingsOpen, setProgress } = useStore();
  const [secrets, setSecrets] = useState<SecretStatus[]>([]);
  const [personaFiles, setPersonaFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [selectedPrompt, setSelectedPrompt] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});

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

  return (
    <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)}>
            x
          </button>
        </div>
        <div className="tab-bar">
          {['api-keys', 'persona', 'prompts', 'progress'].map((tab) => (
            <button
              key={tab}
              className={`tab ${settingsTab === tab ? 'active' : ''}`}
              onClick={() => setSettingsTab(tab)}
            >
              {tab === 'api-keys' ? 'API Keys' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="modal-body">
          {settingsTab === 'api-keys' && (
            <div>
              {secrets.map((s) => (
                <div key={s.key} className="form-group">
                  <label className="form-label">
                    {s.key}
                    {s.configured && <span style={{ color: 'var(--success)', marginLeft: '8px' }}>configured</span>}
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      className="form-input"
                      type="password"
                      placeholder={s.configured ? s.preview : 'Enter API key...'}
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
            </div>
          )}

          {settingsTab === 'persona' && (
            <div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {Object.keys(personaFiles).map((name) => (
                  <button
                    key={name}
                    className={`tab ${selectedFile === name ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedFile(name);
                      setFileContent(personaFiles[name] || '');
                    }}
                  >
                    {name.replace('.md', '')}
                  </button>
                ))}
              </div>
              <textarea
                className="form-input"
                style={{ minHeight: '300px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.6' }}
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button className="btn btn-primary" onClick={handleSavePersona}>Save</button>
                <button className="btn btn-danger" onClick={handleResetPersona}>Reset to Default</button>
              </div>
            </div>
          )}

          {settingsTab === 'prompts' && (
            <div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {Object.keys(prompts).map((key) => (
                  <button
                    key={key}
                    className={`tab ${selectedPrompt === key ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedPrompt(key);
                      setPromptContent(prompts[key] || '');
                    }}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <textarea
                className="form-input"
                style={{ minHeight: '300px', fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.6' }}
                value={promptContent}
                onChange={(e) => setPromptContent(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button className="btn btn-primary" onClick={handleSavePrompt}>Save</button>
                <button className="btn btn-danger" onClick={handleResetPrompts}>Reset to Default</button>
              </div>
            </div>
          )}

          {settingsTab === 'progress' && (
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Reset all gamification progress, installed skills, and persona files.
              </p>
              <button className="btn btn-danger" onClick={handleResetProgress}>
                Reset All Progress
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
