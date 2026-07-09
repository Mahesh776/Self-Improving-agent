import type { Tool } from '../api/client';

interface Props {
  tool: Tool;
  onClose: () => void;
  onDelete: (name: string) => void;
}

export default function ToolDetailPanel({ tool, onClose, onDelete }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: '500px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Skill: {tool.name}</span>
          <button className="icon-btn" onClick={onClose}>x</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Description</label>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
              {tool.description || 'No description'}
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              {tool.kind || 'headless'}
            </p>
          </div>
          <div className="form-group">
            <label className="form-label">Parameters</label>
            <div className="code-block">
              <pre className="code-block-pre">
                <code>{JSON.stringify(tool.parameters, null, 2)}</code>
              </pre>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-danger" onClick={() => { onDelete(tool.name); onClose(); }}>
            Delete Skill
          </button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
