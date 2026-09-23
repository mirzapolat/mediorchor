import { useEffect, useState, type FormEvent } from 'react';
import { Check, ListOrdered, Minus, Plus, Shuffle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Registration } from '@/types';

type Mode = 'first' | 'random';

interface Picked {
  id: string;
  first_name: string;
  last_name: string;
}

const PREVIEW_LIMIT = 8;

// Transfers a chosen number of pending registrations: the earliest ones, or a
// random draw made by the server. Shows who was picked afterwards.
export const RegistrationSelectionDialog = ({
  open,
  pageId,
  pending,
  onClose,
  onTransferred,
}: {
  open: boolean;
  pageId: string;
  // Pending registrations, any order.
  pending: Registration[];
  onClose: () => void;
  onTransferred: () => void;
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('first');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ mode: Mode; picked: Picked[] } | null>(null);

  const total = pending.length;

  useEffect(() => {
    if (!open) return;
    setMode('first');
    setCount(Math.min(1, total));
    setError(null);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clamp = (n: number) => Math.min(Math.max(Number.isFinite(n) ? Math.floor(n) : 1, 1), total);

  // Same order as the server: registration time, earliest first.
  const earliest = [...pending]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, count);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await api.rpc('transfer_registration_selection', {
      p_page_id: pageId,
      p_mode: mode,
      p_count: count,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setResult({ mode, picked: (data as { selected: Picked[] }).selected });
    onTransferred();
  };

  const nameList = (people: Picked[]) => (
    <ul className="divide-y divide-border rounded-md border border-border">
      {people.slice(0, result ? people.length : PREVIEW_LIMIT).map((p, i) => (
        <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="w-6 text-right text-xs tabular-nums text-text-tertiary">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">
            {p.first_name} {p.last_name}
          </span>
          {result && <Check size={15} className="flex-shrink-0 text-[#16803b]" />}
        </li>
      ))}
      {!result && people.length > PREVIEW_LIMIT && (
        <li className="px-3 py-2 text-sm text-text-tertiary">
          {t('selectionAndMore').replace('{n}', String(people.length - PREVIEW_LIMIT))}
        </li>
      )}
    </ul>
  );

  return (
    <Modal
      open={open}
      size="lg"
      title={t('transferSelection')}
      onClose={onClose}
      footer={
        result ? (
          <Button onClick={onClose}>{t('done')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="selection-form" disabled={busy || total === 0}>
              {mode === 'random' ? <Shuffle size={15} /> : <Check size={15} />}
              {busy
                ? t('loading')
                : t(mode === 'random' ? 'selectionDrawSubmit' : 'selectionSubmit').replace('{n}', String(count))}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            {t(result.mode === 'random' ? 'selectionDrawResult' : 'selectionResult').replace(
              '{n}',
              String(result.picked.length),
            )}
          </p>
          {nameList(result.picked)}
        </div>
      ) : (
        <form id="selection-form" onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ['first', ListOrdered, 'selectionFirst', 'selectionFirstHint'],
                ['random', Shuffle, 'selectionRandom', 'selectionRandomHint'],
              ] as const
            ).map(([value, Icon, label, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  'flex items-start gap-3 rounded-md border px-4 py-3 text-left transition-colors duration-150',
                  mode === value ? 'border-black bg-[#fafafa]' : 'border-border hover:bg-[#fafafa]',
                )}
              >
                <Icon size={18} className="mt-0.5 flex-shrink-0" />
                <span>
                  <span className="block text-sm font-medium">{t(label)}</span>
                  <span className="mt-0.5 block text-sm text-text-secondary">{t(hint)}</span>
                </span>
              </button>
            ))}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-text-secondary">{t('selectionCount')}</p>
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center rounded-md border border-border">
                <button
                  type="button"
                  aria-label="−"
                  onClick={() => setCount((c) => clamp(c - 1))}
                  disabled={count <= 1}
                  className="flex h-9 w-9 items-center justify-center text-text-secondary hover:bg-[#f5f5f5] disabled:opacity-40"
                >
                  <Minus size={15} />
                </button>
                <input
                  type="number"
                  min={1}
                  max={total}
                  value={count}
                  onChange={(e) => setCount(clamp(Number(e.target.value)))}
                  className="h-9 w-16 border-x border-border text-center text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  aria-label="+"
                  onClick={() => setCount((c) => clamp(c + 1))}
                  disabled={count >= total}
                  className="flex h-9 w-9 items-center justify-center text-text-secondary hover:bg-[#f5f5f5] disabled:opacity-40"
                >
                  <Plus size={15} />
                </button>
              </div>
              <span className="text-sm text-text-secondary">
                {t('selectionOfPending').replace('{n}', String(total))}
              </span>
            </div>
          </div>

          {mode === 'first' && total > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-text-secondary">{t('selectionPreview')}</p>
              {nameList(earliest)}
            </div>
          )}

          {error && <p className="text-sm text-accent">{error}</p>}
        </form>
      )}
    </Modal>
  );
};
