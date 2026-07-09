import Avatar from './Avatar';
import { useStore } from '../state/store';

const SUGGESTIONS = [
  { icon: 'W', label: 'What can you do?', prompt: 'What are your capabilities? What tools do you have?' },
  { icon: 'C', label: 'Create a calculator', prompt: 'Create a calculator tool that can evaluate math expressions' },
  { icon: 'T', label: 'Tell me about yourself', prompt: 'Tell me about yourself. What is your name and purpose?' },
  { icon: 'F', label: 'Forge a weather tool', prompt: 'Create a tool that fetches weather information for a given city' },
];

export default function WelcomeScreen() {
  const { isStreaming, tools } = useStore();

  return (
    <div className="welcome-screen">
      <Avatar isActive={isStreaming} size={80} />
      <h1>ManusAgent</h1>
      <p>
        Your local AI assistant with the power to forge new skills.
        Ask me anything, or let me create a tool to help you.
      </p>
      <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
        {tools.length} skill{tools.length !== 1 ? 's' : ''} installed
      </p>
      <div className="suggestion-grid">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            className="suggestion-card"
            onClick={() => {
              const textarea = document.querySelector('.composer textarea') as HTMLTextAreaElement;
              if (textarea) {
                textarea.value = s.prompt;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }}
          >
            <span className="suggestion-icon">{s.icon}</span>
            <span className="suggestion-label">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
