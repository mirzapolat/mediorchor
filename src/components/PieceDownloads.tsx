import { memo } from 'react';
import { Avatar } from '@/components/Avatar';
import { useI18n } from '@/lib/i18n';
import type { PieceCredit } from '@/types';

// Who worked on the piece, with their profile photo and role ("made the
// MIDIs" unless set otherwise). Display only: nothing here links anywhere.
export const Credits = memo(({ credits }: { credits: PieceCredit[] }) => {
  const { t } = useI18n();
  return (
    <ul className="space-y-3">
      {credits.map((c) => (
        <li key={c.id} className="flex items-center gap-3">
          <Avatar name={c.name} photoUrl={c.photo_url} size={40} />
          <div className="min-w-0">
            <p className="truncate font-medium">{c.name}</p>
            <p className="text-sm text-text-secondary">{c.role.trim() || t('midiCreditRole')}</p>
          </div>
        </li>
      ))}
    </ul>
  );
});
Credits.displayName = 'Credits';
