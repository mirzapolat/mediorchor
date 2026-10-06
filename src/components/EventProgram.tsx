import { Link } from 'react-router-dom';
import { ChevronRight, ListMusic } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { ProgramItem } from '@/lib/eventProgram';

// What to prepare for a Probe: the general note and the assigned pieces, each
// opening the piece page (also handy during the rehearsal itself).
export const EventProgram = ({
  projectId,
  note,
  items,
}: {
  projectId: string;
  note: string | null;
  items: ProgramItem[];
}) => {
  const { t } = useI18n();
  const pieces = items.filter((i) => i.pieces);
  if (!note && pieces.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
        <ListMusic size={13} className="shrink-0" />
        {t('programToPrepare')}
      </p>
      {note && <p className="mt-1 whitespace-pre-line break-words text-sm text-text-secondary">{note}</p>}
      {pieces.length > 0 && (
        <ol className="mt-1.5 flex flex-col gap-1">
          {pieces.map((item, index) => (
            <li key={item.id}>
              <Link
                to={`/projects/${projectId}/pieces/${item.piece_id}`}
                className="group -mx-2 flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-surface-subtle"
              >
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold tabular-nums text-text-secondary">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium break-words">{item.pieces!.name}</span>
                  {item.note && <span className="block break-words text-text-secondary">{item.note}</span>}
                </span>
                <ChevronRight
                  size={16}
                  className="mt-0.5 flex-shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-text-secondary"
                />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
