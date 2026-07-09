import { useStore } from '../state/store';
import { deleteTool } from '../api/client';

export default function Sidebar() {
  const { tools, setTools, progress } = useStore();

  const handleDelete = async (name: string) => {
    try {
      await deleteTool(name);
      setTools(tools.filter((t) => t.name !== name));
    } catch (err) {
      console.error('Failed to delete tool:', err);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">Skills</div>
      <div className="sidebar-content">
        {tools.length === 0 ? (
          <div className="empty-state">
            No skills installed yet.
            <br />
            Ask Manus to create one!
          </div>
        ) : (
          tools.map((tool) => (
            <div key={tool.name} className="tool-card">
              <button
                className="tool-card-delete"
                onClick={() => handleDelete(tool.name)}
              >
                x
              </button>
              <div className="tool-card-name">{tool.name}</div>
              <div className="tool-card-desc">{tool.description}</div>
            </div>
          ))
        )}
      </div>
      {progress && (
        <div style={{ padding: '12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
            STATS
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            Chats: {progress.chat_count} | Skills: {progress.skills_unlocked}
          </div>
        </div>
      )}
    </div>
  );
}
