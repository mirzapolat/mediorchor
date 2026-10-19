// The kinds of contact details an account can add (account_contacts.kind),
// shared by the server's validation and the app. The order is the order
// they are offered in.
export const CONTACT_KINDS = [
  'phone',
  'email',
  'whatsapp',
  'signal',
  'telegram',
  'instagram',
  'facebook',
  'linkedin',
  'x',
  'tiktok',
  'youtube',
  'threads',
  'bluesky',
  'mastodon',
  'website',
  'other',
] as const;

export type ContactKind = (typeof CONTACT_KINDS)[number];

export const isContactKind = (value: unknown): value is ContactKind =>
  typeof value === 'string' && (CONTACT_KINDS as readonly string[]).includes(value);

export const CONTACT_VALUE_MAX = 300;
export const CONTACT_LABEL_MAX = 60;
