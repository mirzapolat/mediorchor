import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Music,
  Pencil,
  Plus,
  Text,
  Trash2,
} from 'lucide-react';
import { AudioPlayer } from '@/components/AudioPlayer';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { DataTable, type Column } from '@/components/DataTable';
import { RowActionButton } from '@/components/RowActionButton';
import { PieceForm } from '@/components/PieceForm';
import { PieceBlockForm } from '@/components/PieceBlockForm';
import { Markdown } from '@/lib/markdown';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { pieceFileDownloadUrl, pieceFileUrl, removePieceFiles } from '@/lib/pieceFiles';
import { useProjectContext } from '@/layouts/projectContext';
import type { Piece, PieceBlock, PieceBlockType } from '@/types';

const blockTypeOptions: Array<{ type: PieceBlockType; icon: typeof FileText; labelKey: 'blockFile' | 'blockAudio' | 'blockLink' | 'blockText' }> = [
  { type: 'file', icon: FileText, labelKey: 'blockFile' },
  { type: 'audio', icon: Music, labelKey: 'blockAudio' },
  { type: 'link', icon: LinkIcon, labelKey: 'blockLink' },
  { type: 'text', icon: Text, labelKey: 'blockText' },
];

// Subtle bordered action button used inside the "target" column.
const targetButtonClasses =
  'inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border border-border bg-white ' +
  'px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text hover:bg-[#f5f5f5] ' +
  'transition-colors duration-150';

// Renders the "target" cell of a block — the block's primary action:
// download for files, playback (plus download) for audio, opening for links.
const BlockTarget = ({ block }: { block: PieceBlock }) => {
  if (block.type === 'text') {
    return <Markdown source={block.content ?? ''} className="space-y-3 leading-relaxed text-text" />;
  }

  if (block.type === 'link') {
    // Defence in depth: the form only stores http(s) URLs, but never render
    // another scheme (javascript:, data:, …) as a clickable href.
    const safeHref = /^https?:\/\//i.test(block.url ?? '') ? (block.url as string) : '#';
    return (
      <a href={safeHref} target="_blank" rel="noreferrer noopener" className={targetButtonClasses}>
        <span className="truncate">{block.url}</span>
        <ExternalLink size={14} className="flex-shrink-0 text-text-tertiary" />
      </a>
    );
  }

  if (!block.file_path || !block.file_name) {
    return <span className="text-text-tertiary">—</span>;
  }
  const downloadUrl = pieceFileDownloadUrl(block.file_path, block.file_name);

  if (block.type === 'audio') {
    return <AudioPlayer src={pieceFileUrl(block.file_path)} downloadUrl={downloadUrl} />;
  }

  return (
    <a href={downloadUrl} className={targetButtonClasses}>
      <Download size={14} className="flex-shrink-0 text-text-tertiary" />
      <span className="truncate">{block.file_name}</span>
    </a>
  );
};

export const PieceDetailPage = () => {
  const { t } = useI18n();
  const { project, canManage } = useProjectContext();
  const { pieceId } = useParams();
  const navigate = useNavigate();

  const [piece, setPiece] = useState<Piece | null>(null);
  const [blocks, setBlocks] = useState<PieceBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [pieceFormOpen, setPieceFormOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [blockForm, setBlockForm] = useState<{ type: PieceBlockType; block: PieceBlock | null } | null>(null);
  const [toDelete, setToDelete] = useState<PieceBlock | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [pieceResult, blocksResult] = await Promise.all([
      supabase.from('pieces').select('*').eq('id', pieceId).maybeSingle(),
      supabase
        .from('piece_blocks')
        .select('*')
        .eq('piece_id', pieceId)
        .order('position')
        .order('created_at'),
    ]);
    setPiece((pieceResult.data as Piece | null) ?? null);
    setBlocks((blocksResult.data as PieceBlock[] | null) ?? []);
    setLoading(false);
  }, [pieceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (!addMenuRef.current?.contains(e.target as Node)) setAddMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [addMenuOpen]);

  if (loading) return <PageSpinner />;
  if (!piece) {
    navigate(`/projects/${project.id}/pieces`);
    return null;
  }

  const reorder = async (next: PieceBlock[]) => {
    setBlocks(next);
    await Promise.all(
      next.map((block, index) =>
        block.position === index
          ? null
          : supabase.from('piece_blocks').update({ position: index }).eq('id', block.id),
      ),
    );
    await load();
  };

  const blockColumns: Column<PieceBlock>[] = [
    {
      id: 'name',
      header: t('name'),
      render: (block) => {
        const Icon = blockTypeOptions.find((o) => o.type === block.type)?.icon ?? FileText;
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <Icon size={16} className="flex-shrink-0 text-text-secondary" />
            <span className="truncate font-medium">{block.title || block.file_name || '—'}</span>
          </span>
        );
      },
      className: 'align-middle w-1/3',
    },
    {
      id: 'target',
      header: t('target'),
      render: (block) => <BlockTarget block={block} />,
      className: 'align-middle',
    },
  ];

  const removeBlock = async () => {
    if (!toDelete) return;
    await supabase.from('piece_blocks').delete().eq('id', toDelete.id);
    const paths = [toDelete.file_path, toDelete.score_path].filter((p): p is string => !!p);
    if (paths.length) void removePieceFiles(paths);
    setToDelete(null);
    await load();
  };

  return (
    <>
      <button
        onClick={() => navigate(`/projects/${project.id}/pieces`)}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {t('pieces')}
      </button>

      <PageHeader
        title={piece.name}
        subtitle={piece.composer || undefined}
        actions={
          canManage ? (
          <>
            <Button variant="secondary" onClick={() => setPieceFormOpen(true)}>
              <Pencil size={16} />
              {t('edit')}
            </Button>
            <div className="relative" ref={addMenuRef}>
              <Button onClick={() => setAddMenuOpen((v) => !v)}>
                <Plus size={16} />
                {t('addBlock')}
              </Button>
              {addMenuOpen && (
                <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-border bg-white py-1 shadow-lg">
                  {blockTypeOptions.map(({ type, icon: Icon, labelKey }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setBlockForm({ type, block: null });
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[#f5f5f5] transition-colors duration-150"
                    >
                      <Icon size={16} className="text-text-secondary" />
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
          ) : undefined
        }
      />

      <DataTable
        rows={blocks}
        columns={blockColumns}
        getRowId={(block) => block.id}
        onRowClick={(block) =>
          navigate(`/projects/${project.id}/pieces/${piece.id}/practice/${block.id}`)
        }
        rowClickable={(block) =>
          block.type === 'audio' && block.has_bars && block.bars_start != null && block.bars_end != null
        }
        onReorder={canManage ? reorder : undefined}
        emptyMessage={t('noBlocks')}
        emptyIcon={FileText}
        actions={
          canManage
            ? (block) => (
                <>
                  <RowActionButton
                    label={t('edit')}
                    onClick={() => setBlockForm({ type: block.type, block })}
                  >
                    <Pencil size={15} />
                  </RowActionButton>
                  <RowActionButton label={t('delete')} onClick={() => setToDelete(block)}>
                    <Trash2 size={15} />
                  </RowActionButton>
                </>
              )
            : undefined
        }
      />

      <PieceForm
        open={pieceFormOpen}
        projectId={project.id}
        piece={piece}
        nextPosition={0}
        onClose={() => setPieceFormOpen(false)}
        onSaved={load}
      />

      {blockForm && (
        <PieceBlockForm
          open
          pieceId={piece.id}
          type={blockForm.type}
          block={blockForm.block}
          nextPosition={blocks.length}
          onClose={() => setBlockForm(null)}
          onSaved={load}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        title={t('delete')}
        message={t('confirmDelete')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={removeBlock}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
};
