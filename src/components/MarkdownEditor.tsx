import { useRef, useState, type ReactNode } from 'react';
import { Bold, Heading2, Italic, Link as LinkIcon, List } from 'lucide-react';
import { Field } from './Input';
import { Markdown } from '@/lib/markdown';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

interface MarkdownEditorProps {
  id?: string;
  label?: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
}

interface Edit {
  text: string;
  selStart: number;
  selEnd: number;
}

// A small Markdown editor: a formatting toolbar over a textarea, plus a live
// preview tab rendered with the same Markdown renderer used on public pages.
export const MarkdownEditor = ({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  minHeight = 240,
}: MarkdownEditorProps) => {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  const apply = (fn: (val: string, start: number, end: number, selected: string) => Edit) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    const result = fn(value, start, end, value.slice(start, end));
    onChange(result.text);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(result.selStart, result.selEnd);
    });
  };

  const wrap = (marker: string) =>
    apply((val, start, end, selected) => {
      const text = val.slice(0, start) + marker + selected + marker + val.slice(end);
      const selStart = start + marker.length;
      return { text, selStart, selEnd: selStart + selected.length };
    });

  const prefixLines = (prefix: string) =>
    apply((val, start, end) => {
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const block = val.slice(lineStart, end);
      const replaced = block
        .split('\n')
        .map((line) => prefix + line)
        .join('\n');
      const text = val.slice(0, lineStart) + replaced + val.slice(end);
      return { text, selStart: lineStart, selEnd: lineStart + replaced.length };
    });

  const insertLink = () =>
    apply((val, start, end, selected) => {
      const linkLabel = selected || t('link');
      const snippet = `[${linkLabel}](https://)`;
      const text = val.slice(0, start) + snippet + val.slice(end);
      const urlStart = start + linkLabel.length + 3; // past "[label]("
      return { text, selStart: urlStart, selEnd: urlStart + 'https://'.length };
    });

  const tools = [
    { icon: Heading2, label: t('heading'), onClick: () => prefixLines('## ') },
    { icon: Bold, label: t('bold'), onClick: () => wrap('**') },
    { icon: Italic, label: t('italic'), onClick: () => wrap('*') },
    { icon: List, label: t('bulletList'), onClick: () => prefixLines('- ') },
    { icon: LinkIcon, label: t('link'), onClick: insertLink },
  ];

  return (
    <Field label={label} htmlFor={id}>
      <div className="rounded-md border border-border bg-white focus-within:border-black transition-colors duration-150">
        <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            {tools.map(({ icon: Icon, label: toolLabel, onClick }) => (
              <button
                key={toolLabel}
                type="button"
                aria-label={toolLabel}
                title={toolLabel}
                disabled={tab === 'preview'}
                onClick={onClick}
                className="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-[#f0f0f0] hover:text-text disabled:opacity-40 disabled:hover:bg-transparent transition-colors duration-150"
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-sm">
            {(['write', 'preview'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  'rounded px-2 py-1 font-medium transition-colors duration-150',
                  tab === key ? 'bg-[#f0f0f0] text-text' : 'text-text-secondary hover:text-text',
                )}
              >
                {key === 'write' ? t('write') : t('preview')}
              </button>
            ))}
          </div>
        </div>

        {tab === 'write' ? (
          <textarea
            id={id}
            ref={ref}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            style={{ minHeight }}
            className="block w-full resize-y bg-white px-3 py-2.5 text-base placeholder:text-text-tertiary focus:outline-none"
          />
        ) : (
          <div style={{ minHeight }} className="px-3 py-2.5">
            {value.trim() ? (
              <Markdown source={value} className="space-y-3 leading-relaxed text-text" />
            ) : (
              <p className="text-sm text-text-tertiary">{t('nothingToPreview')}</p>
            )}
          </div>
        )}
      </div>
      {hint ? <p className="mt-1.5 text-sm text-text-secondary">{hint}</p> : null}
    </Field>
  );
};
