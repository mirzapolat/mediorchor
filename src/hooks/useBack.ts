import { useMemo, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { historyBack, samePage } from '@/lib/navHistory';
import { useI18n } from '@/lib/i18n';

// A back button that goes where the user came from: the last page before
// they entered `scope` (an area like a piece, or just the current page). With
// no such page in this tab's history (a shared link, a fresh tab) it goes to
// `fallback`, the area's parent page. The label names the target when it is
// the fallback page, else it is just "Zurück".
export const useBack = (fallback: { to: string; label: string }, scope: string) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  // Recomputed on every navigation (the history moved).
  const target = useMemo(() => historyBack(scope), [location.key, scope]);
  const label = !target || samePage(target.path, fallback.to) ? fallback.label : t('back');
  const to = target?.path ?? fallback.to;
  const go = (e?: MouseEvent) => {
    // Keep ⌘/Ctrl-click and middle click opening the link in a new tab.
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
    e?.preventDefault();
    const now = historyBack(scope);
    if (now) navigate(now.delta);
    else navigate(fallback.to);
  };
  return { label, to, go };
};
