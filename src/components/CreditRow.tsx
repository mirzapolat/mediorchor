import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { PieceCredit } from '@/types';

interface AccountResult {
  id: string;
  name: string;
  email: string;
  photo_url: string | null;
}

// One credited person: any name, or an existing account picked from the
// search below the field (its profile photo is then shown), plus what they
// did ("made the MIDIs" when left empty).
export const CreditRow = ({
  credit,
  onChange,
  onRemove,
}: {
  credit: PieceCredit;
  onChange: (patch: Partial<PieceCredit>) => void;
  onRemove: () => void;
}) => {
  const { t } = useI18n();
  const [value, setValue] = useState(credit.name);
  const [linked, setLinked] = useState(credit.user_id);
  const [results, setResults] = useState<AccountResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Suggest accounts while typing a name (not for the linked one as is).
  useEffect(() => {
    const query = value.trim();
    if (!searching || !query) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const { data } = await api.rpc('search_accounts', { p_query: query });
      setResults((data as AccountResult[] | null) ?? []);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, searching]);

  const pick = (account: AccountResult) => {
    const accountName = account.name || account.email;
    setValue(accountName);
    setLinked(account.id);
    setSearching(false);
    onChange({ name: accountName, user_id: account.id });
  };

  // Typed by hand: a plain name, no longer tied to an account.
  const commit = () => {
    setSearching(false);
    const trimmed = value.trim();
    if (linked) return; // unchanged pick
    if (trimmed === credit.name && credit.user_id === null) return;
    onChange({ name: trimmed, user_id: null });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span title={linked ? t('midiCreditLinked') : undefined} className="flex-shrink-0">
          <Avatar name={value || '?'} photoUrl={linked ? credit.photo_url : null} size={32} />
        </span>
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
          <input
            value={value}
            aria-label={t('midiCreditName')}
            placeholder={t('midiCreditPlaceholder')}
            onChange={(e) => {
              setValue(e.target.value);
              setLinked(null);
              setSearching(true);
            }}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-9 min-w-0 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
          />
          <input
            defaultValue={credit.role}
            aria-label={t('creditRole')}
            placeholder={t('midiCreditRole')}
            onBlur={(e) => e.target.value.trim() !== credit.role && onChange({ role: e.target.value.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-9 min-w-0 rounded-md border border-border bg-surface px-3 text-base focus:border-black focus:outline-none sm:text-sm"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('remove')}
          title={t('remove')}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
        >
          <X size={15} />
        </button>
      </div>
      {results.length > 0 && (
        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
          {results.map((account) => (
            <button
              key={account.id}
              type="button"
              // Keep the field focused so its blur doesn't save the typed text first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(account)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface-muted"
            >
              <Avatar name={account.name || account.email} photoUrl={account.photo_url} size={24} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{account.name || account.email}</span>
                <span className="block truncate text-xs text-text-secondary">{account.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
