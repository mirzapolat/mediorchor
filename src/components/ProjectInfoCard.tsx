import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';
import { Input, Field } from './Input';
import { Modal } from './Modal';
import { MarkdownEditor } from './MarkdownEditor';
import { Markdown } from '@/lib/markdown';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { ProjectInfo, ProjectInfoLink } from '@/types';

// Adds a missing scheme ("example.com" → "https://example.com"); null when the
// result still isn't an http(s) URL.
const normalizeUrl = (value: string): string | null => {
  const trimmed = value.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname ? withScheme : null;
  } catch {
    return null;
  }
};

// A link without a label shows its host.
const linkLabel = (link: ProjectInfoLink) => {
  if (link.label.trim()) return link.label.trim();
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return link.url;
  }
};

// The project's info box at the top of "Meine Teilnahme": a Markdown text and
// links. Participants only see it when it has content; managers can edit it,
// and while it's empty they only get a quiet "add" button.
export const ProjectInfoCard = ({ projectId, canEdit }: { projectId: string; canEdit: boolean }) => {
  const { t } = useI18n();
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.from('project_infos').select('*').eq('project_id', projectId).maybeSingle();
    setInfo((data as ProjectInfo) ?? null);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const text = info?.text.trim() ?? '';
  const links = info?.links ?? [];
  const empty = !text && links.length === 0;

  if (empty && !canEdit) return null;

  return (
    <>
      {empty ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mb-4 inline-flex items-center gap-1.5 rounded-md px-2 py-1 -ml-2 text-sm text-text-tertiary transition-colors duration-150 hover:text-text-secondary hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
        >
          <Plus size={14} />
          {t('addProjectInfo')}
        </button>
      ) : (
        <Card className="max-w-3xl mb-4 sm:mb-6 max-sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-medium">{t('projectInfo')}</h2>
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={t('editProjectInfo')}
                title={t('editProjectInfo')}
                className="-mr-1 -mt-1 rounded-md p-1.5 text-text-tertiary transition-colors duration-150 hover:text-text hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
              >
                <Pencil size={15} />
              </button>
            )}
          </div>
          {text && <Markdown source={text} className="mt-2 space-y-2 text-sm break-words" />}
          {links.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {links.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-surface-muted"
                >
                  <ExternalLink size={14} className="shrink-0" />
                  <span className="truncate">{linkLabel(link)}</span>
                </a>
              ))}
            </div>
          )}
        </Card>
      )}

      {editing && (
        <ProjectInfoModal
          projectId={projectId}
          info={info}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setInfo(saved);
            setEditing(false);
          }}
        />
      )}
    </>
  );
};

const ProjectInfoModal = ({
  projectId,
  info,
  onClose,
  onSaved,
}: {
  projectId: string;
  info: ProjectInfo | null;
  onClose: () => void;
  onSaved: (info: ProjectInfo) => void;
}) => {
  const { t } = useI18n();
  const [text, setText] = useState(info?.text ?? '');
  const [links, setLinks] = useState<ProjectInfoLink[]>(info?.links ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateLink = (index: number, patch: Partial<ProjectInfoLink>) =>
    setLinks((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const save = async () => {
    setError(null);
    // Rows left completely blank are dropped; the rest need a valid address.
    const filled = links.filter((l) => l.label.trim() || l.url.trim());
    const cleaned: ProjectInfoLink[] = [];
    for (const link of filled) {
      const url = normalizeUrl(link.url);
      if (!url) {
        setError(t('projectInfoInvalidUrl'));
        return;
      }
      cleaned.push({ label: link.label.trim(), url });
    }
    setBusy(true);
    const { data, error: saveError } = await api
      .from('project_infos')
      .upsert(
        { project_id: projectId, text: text.trim(), links: cleaned, updated_at: new Date().toISOString() },
        { onConflict: 'project_id' },
      )
      .select()
      .single();
    setBusy(false);
    if (saveError || !data) {
      setError(t('projectInfoSaveError'));
      return;
    }
    onSaved(data as ProjectInfo);
  };

  return (
    <Modal
      open
      title={t('editProjectInfo')}
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? t('loading') : t('save')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">{t('projectInfoHint')}</p>
      <MarkdownEditor
        id="project-info-text"
        label={t('projectInfoText')}
        value={text}
        onChange={setText}
        placeholder={t('projectInfoTextPlaceholder')}
      />
      <Field label={t('projectInfoLinks')}>
        <div className="space-y-2">
          {links.map((link, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                <Input
                  value={link.label}
                  onChange={(e) => updateLink(i, { label: e.target.value })}
                  placeholder={t('projectInfoLinkLabel')}
                  aria-label={t('projectInfoLinkLabel')}
                  maxLength={200}
                />
                <Input
                  type="url"
                  inputMode="url"
                  value={link.url}
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                  placeholder={t('projectInfoLinkUrl')}
                  aria-label="URL"
                  maxLength={2000}
                />
              </div>
              <button
                type="button"
                onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                aria-label={t('removeLink')}
                title={t('removeLink')}
                className="mt-1.5 shrink-0 rounded-md p-1.5 text-text-tertiary transition-colors duration-150 hover:text-accent hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {links.length < 30 && (
            <Button variant="secondary" onClick={() => setLinks((prev) => [...prev, { label: '', url: '' }])}>
              <Plus size={15} />
              {t('addLink')}
            </Button>
          )}
        </div>
      </Field>
      {error && <p className="text-sm text-accent">{error}</p>}
    </Modal>
  );
};
