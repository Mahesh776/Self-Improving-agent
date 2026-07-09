import { useCallback, useRef } from 'react';
import { useStore } from '../state/store';
import {
  streamChat,
  streamProposeTool,
  streamApproveTool,
  type ChatMessage,
} from '../api/client';

export function useChatStream() {
  const {
    messages, currentModel,
    addMessage, updateLastAssistant, setStreaming,
    setTools, setProgress,
  } = useStore();
  const controllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    addMessage(userMsg);
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
    addMessage(assistantMsg);

    const allMessages = [...messages, userMsg];

    controllerRef.current = streamChat(
      allMessages,
      currentModel,
      (content) => updateLastAssistant(content),
      (toolCalls) => {
        for (const tc of toolCalls) {
          addMessage({
            role: 'assistant',
            content: '',
            tool_calls: [tc],
          });
        }
      },
      (tool, result) => {
        addMessage({
          role: 'tool',
          content: JSON.stringify(result, null, 2),
          tool_call_id: tool,
        });
      },
      () => {
        setStreaming(false);
        controllerRef.current = null;
        import('../api/client').then(({ getProgress }) => {
          getProgress().then((p) => setProgress(p));
        });
      },
      (err) => {
        updateLastAssistant(`\n\nError: ${err}`);
        setStreaming(false);
        controllerRef.current = null;
      },
    );
  }, [messages, currentModel, addMessage, updateLastAssistant, setStreaming]);

  const stopStreaming = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStreaming(false);
  }, [setStreaming]);

  return { sendMessage, stopStreaming };
}

export function useForgeStream() {
  const {
    currentModel,
    addMessage, updateLastAssistant, setStreaming,
    setSelectedToolPlan, setBuildPhase,
    setTools, setProgress,
  } = useStore();
  const controllerRef = useRef<AbortController | null>(null);

  const proposeTool = useCallback((request: string) => {
    if (!request.trim()) return;

    addMessage({ role: 'user', content: request });
    setStreaming(true);

    addMessage({ role: 'assistant', content: 'Creating a plan for your new tool...' });

    let planText = '';
    controllerRef.current = streamProposeTool(
      request,
      currentModel,
      (chunk) => {
        planText += chunk;
        updateLastAssistant(`Creating a plan for your new tool...\n\n${planText}`);
      },
      (planId, plan) => {
        setSelectedToolPlan({ planId, plan });
        updateLastAssistant('Here is the plan for your new tool. Review and approve below.');
        setStreaming(false);
        controllerRef.current = null;
      },
      (err) => {
        updateLastAssistant(`\n\nError creating plan: ${err}`);
        setStreaming(false);
        controllerRef.current = null;
      },
    );
  }, [currentModel, addMessage, updateLastAssistant, setStreaming, setSelectedToolPlan]);

  const approveTool = useCallback((planId: string) => {
    setStreaming(true);
    setSelectedToolPlan(null);

    controllerRef.current = streamApproveTool(
      planId,
      currentModel,
      (phase, status, message) => {
        setBuildPhase(phase, status);
      },
      (toolName) => {
        updateLastAssistant(`Skill "${toolName}" installed successfully!`);
        import('../api/client').then(({ getTools, getProgress }) => {
          getTools().then((res) => setTools(res.tools));
          getProgress().then((p) => setProgress(p));
        });
      },
      (err) => {
        updateLastAssistant(`\n\nBuild failed: ${err}`);
      },
      (success) => {
        setStreaming(false);
        setBuildPhase(null, null);
        controllerRef.current = null;
      },
    );
  }, [currentModel, setStreaming, setSelectedToolPlan, setBuildPhase, updateLastAssistant, setTools, setProgress]);

  const rejectTool = useCallback(() => {
    setSelectedToolPlan(null);
  }, [setSelectedToolPlan]);

  return { proposeTool, approveTool, rejectTool, stopStreaming: () => { controllerRef.current?.abort(); setStreaming(false); } };
}
