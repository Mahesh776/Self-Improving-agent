import { useEffect } from 'react';
import { useStore } from './state/store';
import { getModels, getTools, getProgress, getConfig } from './api/client';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const { setModels, setTools, setProgress, setModel, settingsOpen } = useStore();

  useEffect(() => {
    async function init() {
      try {
        const [modelsRes, toolsRes, progressRes] = await Promise.all([
          getModels(),
          getTools(),
          getProgress(),
        ]);
        setModels(modelsRes.models);
        setTools(toolsRes.tools);
        setProgress(progressRes);
        if (modelsRes.models.length > 0) {
          setModel(modelsRes.models[0].id);
        }
      } catch (err) {
        console.error('Failed to load config:', err);
      }
    }
    init();
  }, []);

  return (
    <div className="app-shell">
      <Header />
      <div className="main-content">
        <Sidebar />
        <ChatArea />
      </div>
      {settingsOpen && <SettingsModal />}
    </div>
  );
}
