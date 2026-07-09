interface Props {
  phase: string;
  status: string;
}

const PHASES = [
  { key: 'validate', label: 'Validate Code' },
  { key: 'test', label: 'Run Tests' },
  { key: 'install', label: 'Install Skill' },
];

export default function BuildProgress({ phase, status }: Props) {
  const currentIdx = PHASES.findIndex((p) => p.key === phase);

  return (
    <div className="build-progress">
      <div className="message-label">Building Skill</div>
      {PHASES.map((p, i) => {
        let dotClass = 'pending';
        if (i < currentIdx) dotClass = 'completed';
        else if (i === currentIdx) dotClass = status;
        return (
          <div key={p.key} className="build-phase">
            <div className={`build-phase-dot ${dotClass}`} />
            <span>{p.label}</span>
            {i === currentIdx && status === 'running' && (
              <span style={{ color: 'var(--warning)', fontSize: '11px' }}>...</span>
            )}
            {i === currentIdx && status === 'completed' && (
              <span style={{ color: 'var(--success)', fontSize: '11px' }}>done</span>
            )}
            {i === currentIdx && status === 'failed' && (
              <span style={{ color: 'var(--error)', fontSize: '11px' }}>failed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
