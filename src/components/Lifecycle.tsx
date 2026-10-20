import { Archive, ArchiveRestore, Eye, Lock, Send, Undo2, type LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { LIFECYCLE_LABEL, LIFECYCLE_TONE, type LifecycleState } from '@/lib/lifecycle';

// The state of a concert, survey or weekend as a small pill.
export const LifecycleBadge = ({ state, className }: { state: LifecycleState; className?: string }) => {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        LIFECYCLE_TONE[state],
        className,
      )}
    >
      {t(LIFECYCLE_LABEL[state])}
    </span>
  );
};

export type LifecycleAction = 'preview' | 'publish' | 'unpublish' | 'close' | 'reopen' | 'archive' | 'restore';

const ACTIONS: Record<LifecycleAction, { icon: LucideIcon; label: TranslationKey }> = {
  preview: { icon: Eye, label: 'lifecyclePreview' },
  publish: { icon: Send, label: 'lifecyclePublish' },
  unpublish: { icon: Undo2, label: 'lifecycleUnpublish' },
  close: { icon: Lock, label: 'lifecycleClose' },
  reopen: { icon: Send, label: 'lifecycleReopen' },
  archive: { icon: Archive, label: 'lifecycleArchive' },
  restore: { icon: ArchiveRestore, label: 'lifecycleRestore' },
};

// The lifecycle's buttons in their usual order; "publish" is the primary one.
export const LifecycleActions = ({
  actions,
  onAction,
  busy,
}: {
  actions: LifecycleAction[];
  onAction: (action: LifecycleAction) => void;
  busy?: boolean;
}) => {
  const { t } = useI18n();
  return (
    <>
      {actions.map((action) => {
        const { icon: Icon, label } = ACTIONS[action];
        return (
          <Button
            key={action}
            variant={action === 'publish' || action === 'reopen' ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => onAction(action)}
          >
            <Icon size={16} />
            {t(label)}
          </Button>
        );
      })}
    </>
  );
};
