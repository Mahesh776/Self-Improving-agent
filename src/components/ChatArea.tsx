import { useState, useRef, useEffect } from 'react';
import { useStore } from '../state/store';
import { streamChat, streamProposeTool, streamApproveTool, type ChatMessage, type Plan } from '../api/client';
import ToolPlanCard from './ToolPlanCard';
import BuildProgress from './BuildProgress';

export default function ChatArea() {
  const {
    messages, isStreaming, currentModel, tools,
    addMessage, updateLastAssistant, setStreaming,
    selectedToolPlan, setSelectedToolPlan,
    buildPhase, setBuildPhase,
    setTools, setProgress,
  } = useStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    addMessage(userMsg);
    setInput('');
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
    addMessage(assistantMsg);

    const allMessages = [...messages, userMsg];

    streamChat(
      allMessages,
      currentModel,
      (content) => updateLastAssistant(content),
      (toolCalls) => {
        for (const tc of tool_calls) {
          const name = tc.function.name;
          const args = tc.function.arguments;
          const toolMsg: ChatMessage = {
            role: 'assistant',
            content: `Calling tool: ${name}\nArgs: ${args}`,
            tool_calls: [tc],
          };
          addMessage(toolMsg);
        }
      },
      (tool, result) => {
        const resultMsg: ChatMessage = {
          role: 'tool',
          content: `Tool result (${tool}): ${JSON.stringify(result, null, 2)}`,
        };
        addMessage(resultMsg);
      },
      () => {
        setStreaming(false);
      },
      (err) => {
        updateLastAssistant(`\n\nError: ${err}`);
        setStreaming(false);
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const proposeNewTool = () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    addMessage({ role: 'user', content: text });
    setInput('');
    setStreaming(true);

    const assistantMsg: ChatMessage = { role: 'assistant', content: 'Creating a plan for your new tool...' };
    addMessage(assistantMsg);

    let planText = '';
    streamProposeTool(
      text,
      currentModel,
      (chunk) => {
        planText += chunk;
        updateLastAssistant(`Creating a plan for your new tool...\n\n${planText}`);
      },
      (planId, plan) => {
        setSelectedToolPlan({ planId, plan });
        updateLastAssistant('Here is the plan for your new tool. Review and approve below.');
        setStreaming(false);
      },
      (err) => {
        updateLastAssistant(`\n\nError creating plan: ${err}`);
        setStreaming(false);
      },
    );
  };

  const approvePlan = () => {
    if (!selectedToolPlan) return;
    setStreaming(true);
    setSelectedToolPlan(null);

    streamApproveTool(
      selectedToolPlan.planId,
      currentModel,
      (phase, status, message) => {
        setBuildPhase(phase, status);
        if (status === 'completed') {
          updateLastAssistant(`Build phase "${phase}" completed.`);
        }
      },
      (toolName) => {
        updateLastAssistant(`Skill "${toolName}" installed successfully!`);
        getTools().then((res) => setTools(res.tools));
        getProgress().then((p) => setProgress(p));
      },
      (err) => {
        updateLastAssistant(`\n\nBuild failed: ${err}`);
      },
      (success) => {
        setStreaming(false);
        setBuildPhase(null, null);
      },
    );
  };

  const rejectPlan = () => {
    setSelectedToolPlan(null);
  };

  return (
    <div className="chat-area">
      <div className="messages">
        {messages.length === 0 && !isStreaming ? (
          <div className="welcome-screen">
            <h1>ManusAgent</h1>
            <p>
              Your local AI assistant. Ask me anything, or request a new skill
              to be forged.
            </p>
            <p style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
              {tools.length} skills installed | {currentModel}
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="message-label">
                {msg.role === 'user'
                  ? 'You'
                  : msg.role === 'tool'
                  ? 'Tool Result'
                  : msg.tool_calls
                  ? 'Tool Call'
                  : 'Manus'}
              </div>
              <div className="message-content">{msg.content}</div>
            </div>
          ))
        )}
        {selectedToolPlan && (
          <ToolPlanCard
            plan={selectedToolPlan.plan as Plan}
            onApprove={approvePlan}
            onReject={rejectPlan}
          />
        )}
        {buildPhase && <BuildProgress phase={buildPhase} status={useStore.getState().buildStatus || 'running'} />}
        <div ref={messagesEndRef} />
      </div>
      <div className="composer">
        <div className="composer-inner">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Manus anything..."
            rows={1}
          />
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
          >
            {isStreaming ? '...' : 'Send'}
          </button>
        </div>
        <div style={{ maxWidth: '800px', margin: '8px auto 0', display: 'flex', gap: '8px' }}>
          <button
            className="btn"
            onClick={proposeNewTool}
            disabled={isStreaming || !input.trim()}
            style={{ fontSize: '11px', padding: '4px 10px' }}
          >
            Forge New Skill
          </button>
        </div>
      </div>
    </div>
  );
}
