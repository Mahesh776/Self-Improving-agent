import type { Plan } from '../api/client';

interface Props {
  plan: Plan;
  onApprove: () => void;
  onReject: () => void;
}

export default function ToolPlanCard({ plan, onApprove, onReject }: Props) {
  return (
    <div className="plan-card">
      <h3>New Skill: {plan.name || 'Unnamed'}</h3>
      <p>{plan.description || 'No description provided.'}</p>
      {plan.parameters && (
        <div className="plan-params">
          <strong>Parameters:</strong>
          <pre>{JSON.stringify(plan.parameters, null, 2)}</pre>
        </div>
      )}
      {plan.packages && plan.packages.length > 0 && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Packages: {plan.packages.join(', ')}
        </p>
      )}
      {plan.approach && (
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
          Approach: {plan.approach}
        </p>
      )}
      <div className="plan-actions">
        <button className="btn btn-primary" onClick={onApprove}>
          Approve & Build
        </button>
        <button className="btn btn-danger" onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}
