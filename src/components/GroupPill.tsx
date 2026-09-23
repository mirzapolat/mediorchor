import { useProjectGroups } from '@/hooks/useProjectGroups';
import { FALLBACK_GROUP_COLOR, isHexColor } from '@/lib/groupColors';
import { cn } from '@/lib/cn';

// A group name in a pill tinted with the group's color. Groups that aren't in
// the project (yet) render grey.
export const GroupPill = ({
  name,
  color,
  className,
}: {
  name: string | null | undefined;
  // Explicit color (e.g. a live preview); otherwise looked up by name.
  color?: string;
  className?: string;
}) => {
  const { find } = useProjectGroups();
  if (!name) return <span className="text-text-tertiary">—</span>;
  const raw = color ?? find(name)?.color ?? FALLBACK_GROUP_COLOR;
  const c = isHexColor(raw) ? raw : FALLBACK_GROUP_COLOR;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-text',
        className,
      )}
      style={{ backgroundColor: `${c}1a`, borderColor: `${c}59` }}
    >
      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: c }} />
      <span className="truncate">{name}</span>
    </span>
  );
};
