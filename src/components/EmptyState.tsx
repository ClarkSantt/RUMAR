import { Check, type LucideIcon } from 'lucide-react';
export function EmptyState({
  title,
  description,
  icon: Icon = Check,
  action,
  secondaryAction,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol" aria-hidden="true">
        <Icon size={22} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {(action || secondaryAction) && (
        <div className="empty-actions">
          {action && (
            <button className="primary-button" onClick={action.onClick}>
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button className="secondary-button" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
