import { useEffect, useCallback } from 'react';
import { useStore } from '../state/store';

export function useKeyboardShortcuts() {
  const { setSettingsOpen, settingsOpen, clearChat, isStreaming } = useStore();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && settingsOpen) {
      setSettingsOpen(false);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      setSettingsOpen(!settingsOpen);
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
      e.preventDefault();
      if (!isStreaming) clearChat();
    }
  }, [settingsOpen, isStreaming, setSettingsOpen, clearChat]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
