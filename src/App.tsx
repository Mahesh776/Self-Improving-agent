import { useEffect } from 'react';
import { useStore } from './state/store';
import { getModels, getTools, getProgress } from './api/client';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ToastProvider } from './components/Toast';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsModal from './components/SettingsModal';

function AppContent() {
  const { setModels, setTools, setProgress, setModel, settingsOpen } = useStore();
  useKeyboardShortcuts();

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

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
