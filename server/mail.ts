// Outgoing email (optional). Only used when SMTP_HOST and SMTP_FROM are set.
import nodemailer from 'nodemailer';
import { env, mailEnabled } from './env.ts';

const transport = mailEnabled
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

const from = () => (env.smtp.fromName ? `"${env.smtp.fromName}" <${env.smtp.from}>` : env.smtp.from!);

export const sendMail = async (to: string, subject: string, text: string) => {
  if (!transport) throw new Error('Email is not configured');
  await transport.sendMail({ from: from(), to, subject, text });
};

const appName = () => env.client.VITE_APP_NAME;

export const sendConfirmSignup = (to: string, link: string) =>
  sendMail(
    to,
    `${appName()}: Bitte E-Mail-Adresse bestätigen / Confirm your email`,
    [
      'Hallo,',
      '',
      'bitte bestätige deine E-Mail-Adresse über diesen Link:',
      link,
      '',
      'Hello,',
      '',
      'please confirm your email address using this link:',
      link,
      '',
      'Der Link ist 24 Stunden gültig. / The link is valid for 24 hours.',
    ].join('\n'),
  );

export const sendConfirmEmailChange = (to: string, link: string) =>
  sendMail(
    to,
    `${appName()}: Neue E-Mail-Adresse bestätigen / Confirm your new email`,
    [
      'Hallo,',
      '',
      'bitte bestätige deine neue E-Mail-Adresse über diesen Link:',
      link,
      '',
      'Hello,',
      '',
      'please confirm your new email address using this link:',
      link,
      '',
      'Der Link ist 24 Stunden gültig. / The link is valid for 24 hours.',
    ].join('\n'),
  );
