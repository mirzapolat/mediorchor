// Link previews (Open Graph / Twitter tags) for shared URLs. Messengers and
// social sites fetch the page without a session and never run the SPA, so
// the server writes the tags into index.html per path: a piece shows its
// name, composer and the top of its score; the pieces list names its pieces.
// The URLs carry unguessable ids, and the score files are public already.
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.ts';
import { env } from './env.ts';
import { branding } from './branding.ts';

export interface PageMeta {
  title: string;
  description: string;
  // Absolute URL of a 1200×630 image, else the app icon is used.
  image: string | null;
}

// Score preview rendered by the browser (src/lib/scorePreview.ts), keyed by
// the score file it shows, so a replaced score gets a new preview.
const scorePreviewKey = (pieceId: string, scoreFileId: string) => `${pieceId}/preview-${scoreFileId}.jpg`;

const SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

const pieceMeta = (base: string, projectId: string, pieceId: string): PageMeta | null => {
  const piece = db
    .prepare(
      `select p.name, p.composer, p.description, pr.name as project
       from pieces p
       join project_pieces pp on pp.piece_id = p.id
       join projects pr on pr.id = pp.project_id
       where p.id = ? and pp.project_id = ?`,
    )
    .get(pieceId, projectId) as { name: string; composer: string; description: string; project: string } | undefined;
  if (!piece) return null;

  // The score shown on the page: the first one, like the piece page picks it.
  const score = db
    .prepare(
      `select id from piece_files where piece_id = ? and kind = 'score' and file_path is not null
       order by position, created_at limit 1`,
    )
    .get(pieceId) as { id: string } | undefined;
  const key = score && SEGMENT.test(score.id) ? scorePreviewKey(pieceId, score.id) : null;
  const hasPreview = key !== null && fs.existsSync(path.join(env.storageDir, 'piece-files', key));

  const composer = piece.composer.trim();
  return {
    title: composer ? `${piece.name} – ${composer}` : piece.name,
    description: [composer, piece.description.trim(), piece.project].filter(Boolean).join(' · '),
    image: hasPreview ? `${base}/files/piece-files/${key}` : null,
  };
};

const piecesMeta = (projectId: string): PageMeta | null => {
  const project = db.prepare('select name from projects where id = ?').get(projectId) as { name: string } | undefined;
  if (!project) return null;
  const pieces = db
    .prepare(
      `select p.name, p.composer from project_pieces pp join pieces p on p.id = pp.piece_id
       where pp.project_id = ? order by pp.position, pp.created_at`,
    )
    .all(projectId) as Array<{ name: string; composer: string }>;
  const list = pieces.map((p) => (p.composer.trim() ? `${p.name} (${p.composer.trim()})` : p.name));
  const shown = list.slice(0, 6).join(', ') + (list.length > 6 ? ', …' : '');
  return {
    title: `Stücke · ${project.name}`,
    description:
      pieces.length === 0 ? project.name : `${pieces.length} ${pieces.length === 1 ? 'Stück' : 'Stücke'}: ${shown}`,
    image: null,
  };
};

// Meta for a page path, or null for the instance-wide defaults.
export const pageMeta = (pathname: string, base: string): PageMeta | null => {
  const m = /^\/projects\/([^/]+)\/pieces(?:\/([^/]+))?(?:\/.*)?$/.exec(pathname);
  if (!m || !SEGMENT.test(m[1]) || (m[2] !== undefined && !SEGMENT.test(m[2]))) return null;
  try {
    return m[2] ? pieceMeta(base, m[1], m[2]) : piecesMeta(m[1]);
  } catch {
    return null;
  }
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// The tags for one page; `url` is the absolute page URL.
export const previewTags = (meta: PageMeta | null, url: string, base: string) => {
  const { appName } = branding();
  const title = meta?.title ?? appName;
  const image = meta?.image ?? `${base}/icon-512.png`;
  const large = Boolean(meta?.image);
  const tags: Array<[string, string, string]> = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', appName],
    ['property', 'og:title', title],
    ['property', 'og:url', url],
    ['property', 'og:image', image],
    ['name', 'twitter:card', large ? 'summary_large_image' : 'summary'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:image', image],
  ];
  if (large) tags.push(['property', 'og:image:width', '1200'], ['property', 'og:image:height', '630']);
  if (meta?.description) {
    tags.push(
      ['name', 'description', meta.description],
      ['property', 'og:description', meta.description],
      ['name', 'twitter:description', meta.description],
    );
  }
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`).join('\n    ');
};
