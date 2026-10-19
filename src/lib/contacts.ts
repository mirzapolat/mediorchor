import {
  AtSign,
  Cloud,
  Contact,
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  Mail,
  MessageCircle,
  MessageSquareLock,
  Music2,
  Phone,
  Send,
  Twitter,
  Youtube,
  type LucideIcon,
} from 'lucide-react';
import type { ContactKind } from '@shared/contactKinds';
import type { TranslationKey } from './i18n';

// What the app knows about each kind of contact detail: its icon and colour
// (theme tokens), how it is entered, and the one-click link it becomes
// (call, write, open the chat or profile). See shared/contactKinds.ts.

// What a contact's link does, for its button's label.
export type ContactAction = 'call' | 'write' | 'chat' | 'profile' | 'open';

interface KindInfo {
  icon: LucideIcon;
  tone: string;
  // Example input; null = the generic "username or link".
  placeholder: string | null;
  action: ContactAction;
  // The link, or null when the value can't be one (it is copied instead).
  href: (value: string) => string | null;
}

// An http(s) address as typed (a scheme is added when missing), or null.
const webUrl = (value: string): string | null => {
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};
// A link pasted as the value is used as it is.
const pastedLink = (value: string) => (/^https?:\/\//i.test(value.trim()) ? webUrl(value) : null);

// "+49 170 123-4567", "0049 …" → "+491701234567"; local numbers keep their 0.
const phoneNumber = (value: string): string | null => {
  const raw = value.trim().replace(/^00/, '+');
  if (!/^\+?[\d\s()./-]{5,}$/.test(raw)) return null;
  const digits = raw.replace(/[^\d]/g, '');
  return digits.length >= 5 ? (raw.startsWith('+') ? `+${digits}` : digits) : null;
};
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
// "@name", "name" → "name" (characters a profile address can hold).
const handle = (value: string): string | null => {
  const h = value.trim().replace(/^@/, '');
  return /^[\w.-]{1,100}$/.test(h) ? h : null;
};
const profile = (base: string) => (value: string) => {
  const link = pastedLink(value);
  if (link) return link;
  const h = handle(value);
  return h ? `${base}${encodeURIComponent(h)}` : null;
};

export const CONTACT_INFO: Record<ContactKind, KindInfo> = {
  phone: {
    icon: Phone,
    tone: 'text-success',
    placeholder: '+49 170 1234567',
    action: 'call',
    href: (v) => {
      const n = phoneNumber(v);
      return n ? `tel:${n}` : null;
    },
  },
  email: {
    icon: Mail,
    tone: 'text-chart-1',
    placeholder: 'name@example.org',
    action: 'write',
    href: (v) => (looksLikeEmail(v) ? `mailto:${v.trim()}` : null),
  },
  whatsapp: {
    icon: MessageCircle,
    tone: 'text-success',
    placeholder: '+49 170 1234567',
    action: 'chat',
    href: (v) => {
      const link = pastedLink(v);
      if (link) return link;
      const n = phoneNumber(v);
      return n?.startsWith('+') ? `https://wa.me/${n.slice(1)}` : null;
    },
  },
  signal: {
    icon: MessageSquareLock,
    tone: 'text-chart-1',
    placeholder: '+49 170 1234567',
    action: 'chat',
    href: (v) => {
      const link = pastedLink(v);
      if (link) return link;
      const n = phoneNumber(v);
      return n?.startsWith('+') ? `https://signal.me/#p/${n}` : null;
    },
  },
  telegram: {
    icon: Send,
    tone: 'text-chart-2',
    placeholder: null,
    action: 'chat',
    href: (v) => {
      const link = pastedLink(v);
      if (link) return link;
      const n = phoneNumber(v);
      if (n?.startsWith('+')) return `https://t.me/${n}`;
      const h = handle(v);
      return h ? `https://t.me/${encodeURIComponent(h)}` : null;
    },
  },
  instagram: { icon: Instagram, tone: 'text-chart-5', placeholder: null, action: 'profile', href: profile('https://www.instagram.com/') },
  facebook: { icon: Facebook, tone: 'text-chart-1', placeholder: null, action: 'profile', href: profile('https://www.facebook.com/') },
  linkedin: { icon: Linkedin, tone: 'text-chart-1', placeholder: null, action: 'profile', href: profile('https://www.linkedin.com/in/') },
  x: { icon: Twitter, tone: 'text-text', placeholder: null, action: 'profile', href: profile('https://x.com/') },
  tiktok: { icon: Music2, tone: 'text-text', placeholder: null, action: 'profile', href: profile('https://www.tiktok.com/@') },
  youtube: { icon: Youtube, tone: 'text-danger', placeholder: null, action: 'profile', href: profile('https://www.youtube.com/@') },
  threads: { icon: AtSign, tone: 'text-text', placeholder: null, action: 'profile', href: profile('https://www.threads.net/@') },
  bluesky: {
    icon: Cloud,
    tone: 'text-chart-2',
    placeholder: 'name.bsky.social',
    action: 'profile',
    href: (v) => {
      const link = pastedLink(v);
      if (link) return link;
      const h = handle(v);
      return h ? `https://bsky.app/profile/${encodeURIComponent(h)}` : null;
    },
  },
  mastodon: {
    icon: AtSign,
    tone: 'text-chart-3',
    placeholder: '@name@mastodon.social',
    action: 'profile',
    href: (v) => {
      const link = pastedLink(v);
      if (link) return link;
      const m = /^@?([\w.-]+)@([\w.-]+\.[a-z]{2,})$/i.exec(v.trim());
      return m ? `https://${m[2]}/@${encodeURIComponent(m[1])}` : null;
    },
  },
  website: { icon: Globe, tone: 'text-chart-4', placeholder: 'https://', action: 'open', href: webUrl },
  // Anything else: a link, an email or a phone number still becomes one.
  other: {
    icon: Contact,
    tone: 'text-text-secondary',
    placeholder: '',
    action: 'open',
    href: (v) => {
      if (looksLikeEmail(v)) return `mailto:${v.trim()}`;
      const n = phoneNumber(v);
      if (n) return `tel:${n}`;
      return /^https?:\/\//i.test(v.trim()) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v.trim()) ? webUrl(v) : null;
    },
  },
};

export const contactKindLabel = (kind: ContactKind): TranslationKey => `contactKind_${kind}` as TranslationKey;

export const contactActionLabel: Record<ContactAction, TranslationKey> = {
  call: 'contactCall',
  write: 'contactWrite',
  chat: 'contactChat',
  profile: 'contactProfile',
  open: 'contactOpen',
};

// Links that leave the app open in a new tab; tel:/mailto: hand over to
// the phone or mail app.
export const opensNewTab = (href: string) => /^https?:/i.test(href);
