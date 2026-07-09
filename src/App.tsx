import { useEffect } from 'react';
import { useStore } from './state/store';
import { getModels, getTools, getProgress, getChatHistory } from './api/client';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ToastProvider } from './components/Toast';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsModal from './components/SettingsModal';

function AppContent() {
  const { setModels, setTools, setProgress, setModel, settingsOpen, addMessage } = useStore();
  useKeyboardShortcuts();

  useEffect(() => {
    async function init() {
      try {
        const [modelsRes, toolsRes, progressRes, historyRes] = await Promise.all([
          getModels(),
          getTools(),
          getProgress(),
          getChatHistory(),
        ]);
        setModels(modelsRes.models);
        setTools(toolsRes.tools);
        setProgress(progressRes);
        const zenModel = modelsRes.models.find((m: any) => m.id === 'zen/deepseek-v4-flash-free');
        if (zenModel) {
          setModel(zenModel.id);
        } else if (modelsRes.models.length > 0) {
          setModel(modelsRes.models[0].id);
        }
        if (historyRes.messages && historyRes.messages.length > 0) {
          for (const msg of historyRes.messages) {
            addMessage({
              role: msg.role as 'user' | 'assistant' | 'tool',
              content: msg.content || '',
              tool_calls: msg.tool_calls,
              tool_call_id: msg.tool_call_id,
            });
          }
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
