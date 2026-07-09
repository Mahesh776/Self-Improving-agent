import { create } from 'zustand';
import type { ChatMessage, Tool, Progress, Model } from '../api/client';

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentModel: string;
  availableModels: Model[];
  tools: Tool[];
  progress: Progress | null;
  selectedToolPlan: { planId: string; plan: unknown } | null;
  buildPhase: string | null;
  buildStatus: string | null;
  settingsOpen: boolean;
  settingsTab: string;
  sidebarCollapsed: boolean;

  addMessage: (msg: ChatMessage) => void;
  updateLastAssistant: (content: string) => void;
  removeMessage: (idx: number) => void;
  setStreaming: (v: boolean) => void;
  setModel: (m: string) => void;
  setModels: (m: Model[]) => void;
  setTools: (t: Tool[]) => void;
  setProgress: (p: Progress) => void;
  setSelectedToolPlan: (p: { planId: string; plan: unknown } | null) => void;
  setBuildPhase: (phase: string | null, status: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsTab: (tab: string) => void;
  setSidebarCollapsed: (c: boolean) => void;
  clearChat: () => void;
}

export const useStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentModel: 'openai/gpt-4o-mini',
  availableModels: [],
  tools: [],
  progress: null,
  selectedToolPlan: null,
  buildPhase: null,
  buildStatus: null,
  settingsOpen: false,
  settingsTab: 'api-keys',
  sidebarCollapsed: false,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateLastAssistant: (content) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && !last.tool_calls) {
        msgs[msgs.length - 1] = { ...last, content: (last.content || '') + content };
      } else {
        msgs.push({ role: 'assistant', content });
      }
      return { messages: msgs };
    }),
  removeMessage: (idx) =>
    set((s) => ({
      messages: s.messages.filter((_, i) => i !== idx),
    })),
  setStreaming: (v) => set({ isStreaming: v }),
  setModel: (m) => set({ currentModel: m }),
  setModels: (m) => set({ availableModels: m }),
  setTools: (t) => set({ tools: t }),
  setProgress: (p) => set({ progress: p }),
  setSelectedToolPlan: (p) => set({ selectedToolPlan: p }),
  setBuildPhase: (phase, status) => set({ buildPhase: phase, buildStatus: status }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setSidebarCollapsed: (c) => set({ sidebarCollapsed: c }),
  clearChat: () => set({ messages: [], selectedToolPlan: null, buildPhase: null, buildStatus: null }),
}));
