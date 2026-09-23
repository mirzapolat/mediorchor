import { Fragment, type ReactNode } from 'react';

// A deliberately small, dependency-free Markdown renderer. It produces React
// nodes (so text is always escaped by React) and supports the subset that makes
// sense for a registration page description: headings, unordered/ordered lists,
// bold, italic, inline code and safe links.

const INLINE = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;

const isSafeUrl = (url: string) =>
  /^(https?:\/\/|mailto:)/i.test(url) || url.startsWith('/');

const renderInline = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [, , bold, italic, code, linkText, linkUrl] = match;
    if (bold !== undefined) {
      nodes.push(<strong key={key++}>{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key++}>{italic}</em>);
    } else if (code !== undefined) {
      nodes.push(
        <code key={key++} className="rounded bg-surface-hover px-1 py-0.5 text-[0.9em]">
          {code}
        </code>,
      );
    } else if (linkText !== undefined && linkUrl !== undefined) {
      if (isSafeUrl(linkUrl)) {
        nodes.push(
          <a
            key={key++}
            href={linkUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline underline-offset-2 hover:opacity-80"
          >
            {linkText}
          </a>,
        );
      } else {
        nodes.push(linkText);
      }
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

// Split paragraph text on single newlines, inserting <br/> between the lines.
const renderParagraphLines = (block: string): ReactNode[] => {
  const lines = block.split('\n');
  return lines.flatMap((line, index) => {
    const inline = renderInline(line);
    return index < lines.length - 1
      ? [<Fragment key={index}>{inline}</Fragment>, <br key={`br-${index}`} />]
      : [<Fragment key={index}>{inline}</Fragment>];
  });
};

export const Markdown = ({ source, className }: { source: string; className?: string }) => {
  const blocks = source.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const lines = block.split('\n');

        const heading = block.match(/^(#{1,3})\s+(.*)$/);
        if (heading && lines.length === 1) {
          const level = heading[1].length;
          const content = renderInline(heading[2]);
          if (level === 1) return <h1 key={index} className="text-xl font-bold">{content}</h1>;
          if (level === 2) return <h2 key={index} className="text-lg font-semibold">{content}</h2>;
          return <h3 key={index} className="text-base font-semibold">{content}</h3>;
        }

        if (lines.every((line) => /^[-*]\s+/.test(line))) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>{renderInline(line.replace(/^[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }

        if (lines.every((line) => /^\d+\.\s+/.test(line))) {
          return (
            <ol key={index} className="list-decimal space-y-1 pl-5">
              {lines.map((line, i) => (
                <li key={i}>{renderInline(line.replace(/^\d+\.\s+/, ''))}</li>
              ))}
            </ol>
          );
        }

        return <p key={index}>{renderParagraphLines(block)}</p>;
      })}
    </div>
  );
};
