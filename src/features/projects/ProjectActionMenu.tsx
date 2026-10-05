import type { ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';

export function ProjectActionMenu({
  label,
  children,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <details
      className="project-menu"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }}
    >
      <summary
        aria-label={label}
        title={label}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          const menu = event.currentTarget.parentElement as HTMLDetailsElement;
          menu.open = !menu.open;
        }}
      >
        <Ellipsis size={18} />
        {!compact && <span>Mais ações</span>}
      </summary>
      <div
        className="project-menu-content"
        onClick={(event) => {
          const menu = event.currentTarget.closest('details');
          if (menu) menu.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
