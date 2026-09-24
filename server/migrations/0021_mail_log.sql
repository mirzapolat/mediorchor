-- Outgoing email log for the sending statistics (Admin → Email). Privacy by
-- design: only when, what kind and whether it worked — no recipient, subject
-- or content. Failures keep the SMTP/nodemailer error code (e.g. EAUTH), not
-- the message, which can contain addresses. No data-API policy: only the
-- admin-only statistics function reads it. Rows older than ~13 months are
-- purged.
create table mail_log (
  id      integer primary key autoincrement,
  sent_at text not null default (now_iso()),
  kind    text not null check (kind in ('account', 'reminder', 'status', 'weekly', 'test')),
  ok      boolean not null,
  error   text
);
create index mail_log_sent_idx on mail_log (sent_at);
