import { useState, useRef, useEffect } from 'react';
import { useStore } from '../state/store';
import { useChatStream, useForgeStream } from '../hooks/useStreams';
import ToolPlanCard from './ToolPlanCard';
import BuildProgress from './BuildProgress';
import WelcomeScreen from './WelcomeScreen';
import Avatar from './Avatar';
import MarkdownRenderer from './MarkdownRenderer';
import type { ChatMessage } from '../api/client';

export default function ChatArea() {
  const {
    messages, isStreaming, currentModel, tools,
    selectedToolPlan, setSelectedToolPlan,
    buildPhase, buildStatus,
    setTools, setProgress,
  } = useStore();

  const { sendMessage, stopStreaming } = useChatStream();
  const { proposeTool, approveTool, rejectTool } = useForgeStream();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msgIdx: number } | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedToolPlan, buildPhase]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    sendMessage(text);
  };

  const handleForge = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    proposeTool(text);
  };

  const handleApprove = () => {
    if (!selectedToolPlan) return;
    approveTool(selectedToolPlan.planId);
  };

  const handleContextMenu = (e: React.MouseEvent, msgIdx: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, msgIdx });
  };

  const handleCopyMessage = (msgIdx: number) => {
    const msg = messages[msgIdx];
    if (msg) {
      navigator.clipboard.writeText(msg.content);
      setContextMenu(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const renderMessage = (msg: ChatMessage, idx: number) => {
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      return (
        <div key={idx} className="message tool-call" onContextMenu={(e) => handleContextMenu(e, idx)}>
          <div className="message-label">Tool Call</div>
          {msg.tool_calls.map((tc, i) => (
            <div key={i}>
              <div style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: '4px' }}>
                {tc.function.name}
              </div>
              <div className="code-block" style={{ marginTop: '4px' }}>
                <pre className="code-block-pre">
                  <code>{(() => { try { return JSON.stringify(JSON.parse(tc.function.arguments), null, 2); } catch { return tc.function.arguments; } })()}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (msg.role === 'tool') {
      return (
        <div key={idx} className="message tool-result" onContextMenu={(e) => handleContextMenu(e, idx)}>
          <div className="message-label">Tool Result</div>
          <div className="code-block">
            <pre className="code-block-pre">
              <code>{msg.content}</code>
            </pre>
          </div>
        </div>
      );
    }

    return (
      <div
        key={idx}
        className={`message ${msg.role}`}
        onContextMenu={(e) => handleContextMenu(e, idx)}
      >
        <div className="message-label">
          {msg.role === 'user' ? 'You' : 'Manus'}
          {isStreaming && idx === messages.length - 1 && msg.role === 'assistant' && (
            <span className="typing-indicator">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </span>
          )}
        </div>
        <div className="message-content">
          {msg.role === 'assistant' ? (
            <MarkdownRenderer content={msg.content} />
          ) : (
            msg.content
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="chat-area">
      <div className="messages">
        {messages.length === 0 && !isStreaming ? (
          <WelcomeScreen />
        ) : (
          messages.map((msg, i) => renderMessage(msg, i))
        )}
        {selectedToolPlan && (
          <ToolPlanCard
            plan={selectedToolPlan.plan as any}
            onApprove={handleApprove}
            onReject={rejectTool}
          />
        )}
        {buildPhase && <BuildProgress phase={buildPhase} status={buildStatus || 'running'} />}
        <div ref={messagesEndRef} />
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={() => handleCopyMessage(contextMenu.msgIdx)}>Copy</button>
          <button onClick={() => setContextMenu(null)}>Delete</button>
        </div>
      )}

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
          {isStreaming ? (
            <button className="send-btn stop-btn" onClick={stopStreaming}>
              Stop
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
        <div className="composer-actions">
          <button
            className="btn forge-btn"
            onClick={handleForge}
            disabled={isStreaming || !input.trim()}
          >
            Forge New Skill
          </button>
          <span className="composer-hint">
            Shift+Enter for newline | Ctrl+, for settings
          </span>
        </div>
      </div>
    </div>
  );
}
