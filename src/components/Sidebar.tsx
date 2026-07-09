import { useState } from 'react';
import { useStore } from '../state/store';
import { deleteTool, type Tool } from '../api/client';
import ToolDetailPanel from './ToolDetailPanel';
import { useToast } from './Toast';

export default function Sidebar() {
  const { tools, setTools, progress } = useStore();
  const { addToast } = useToast();
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const handleDelete = async (name: string) => {
    try {
      await deleteTool(name);
      setTools(tools.filter((t) => t.name !== name));
      addToast(`Skill "${name}" deleted`, 'success');
    } catch (err) {
      addToast('Failed to delete skill', 'error');
    }
  };

  if (collapsed) {
    return (
      <div className="sidebar collapsed">
        <button className="sidebar-toggle" onClick={() => setCollapsed(false)}>
          {'>'}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-header">
          <span>Skills</span>
          <button className="sidebar-toggle" onClick={() => setCollapsed(true)}>
            {'<'}
          </button>
        </div>
        <div className="sidebar-content">
          {tools.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.3 }}>F</div>
              No skills installed yet.
              <br />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Ask Manus to forge one!
              </span>
            </div>
          ) : (
            tools.map((tool) => (
              <div
                key={tool.name}
                className="tool-card"
                onClick={() => setSelectedTool(tool)}
              >
                <button
                  className="tool-card-delete"
                  onClick={(e) => { e.stopPropagation(); handleDelete(tool.name); }}
                >
                  x
                </button>
                <div className="tool-card-name">{tool.name}</div>
                <div className="tool-card-desc">
                  {tool.description?.slice(0, 80) || 'No description'}
                  {tool.description && tool.description.length > 80 ? '...' : ''}
                </div>
                {tool.kind && (
                  <span className="tool-card-kind">{tool.kind}</span>
                )}
              </div>
            ))
          )}
        </div>
        {progress && (
          <div className="sidebar-stats">
            <div className="sidebar-stats-title">Stats</div>
            <div className="sidebar-stat">
              <span>Chats</span>
              <span className="sidebar-stat-value">{progress.chat_count}</span>
            </div>
            <div className="sidebar-stat">
              <span>Skills</span>
              <span className="sidebar-stat-value">{progress.skills_unlocked}</span>
            </div>
            <div className="sidebar-stat">
              <span>XP</span>
              <span className="sidebar-stat-value">{progress.xp}</span>
            </div>
          </div>
        )}
      </div>
      {selectedTool && (
        <ToolDetailPanel
          tool={selectedTool}
          onClose={() => setSelectedTool(null)}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}
