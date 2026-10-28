import type { ReactNode } from 'react';
import AdminNav from './AdminNav';
import { useAdminTheme } from '../../hooks/useAdminTheme';

/**
 * Studio chrome: warm sidebar + page. The live host desk keeps the dark game skin.
 */
export default function AdminShell({
  children,
  contextLabel,
  maxWidthClass = 'max-w-5xl',
  contentClassName = 'space-y-6',
  showTabs = true,
  brandSlot,
  stage = false,
}: {
  children: ReactNode;
  contextLabel?: ReactNode;
  maxWidthClass?: string;
  contentClassName?: string;
  /** When false, this is the live host desk — no studio sidebar. */
  showTabs?: boolean;
  brandSlot?: ReactNode;
  /** Shared stage geometry for the live host desk. */
  stage?: boolean;
}) {
  useAdminTheme();
  const stageClass = stage ? 'stage ' : '';

  if (!showTabs) {
    return (
      <div className={`${stageClass}min-h-screen px-4 py-8 md:px-10`}>
        <div className={`mx-auto ${maxWidthClass} ${contentClassName}`}>
          <header className="space-y-3">
            {brandSlot}
          </header>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="admin-app min-h-screen flex">
      <AdminNav />
      <div className="studio-main min-w-0 flex-1 px-5 py-8 md:px-10">
        <div className={`mx-auto ${maxWidthClass} ${contentClassName}`}>
          {contextLabel != null && contextLabel !== false && (
            <p className="text-sm text-[var(--muted)]">{contextLabel}</p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
