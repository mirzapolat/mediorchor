// Deutsche E-Mail-Texte. Aufbau wie in en.ts.

import type { MailTexts } from './en.ts';

const hallo = (name?: string) => (name ? `Hallo ${name},` : 'Hallo,');

const de: MailTexts = {
  time: (time) => `${time} Uhr`,
  autoSent: 'Diese E-Mail wurde automatisch verschickt.',
  notificationFooter: 'Du erhältst diese E-Mail, weil du Benachrichtigungen in deinem Konto aktiviert hast.',

  confirmSignup: (link) => ({
    subject: 'Bitte E-Mail-Adresse bestätigen',
    lines: [hallo(), '', 'bitte bestätige deine E-Mail-Adresse über diesen Link:', link, '', 'Der Link ist 24 Stunden gültig.'],
  }),
  confirmEmailChange: (link) => ({
    subject: 'Neue E-Mail-Adresse bestätigen',
    lines: [
      hallo(),
      '',
      'bitte bestätige deine neue E-Mail-Adresse über diesen Link:',
      link,
      '',
      'Der Link ist 24 Stunden gültig.',
    ],
  }),
  passwordReset: (link) => ({
    subject: 'Passwort zurücksetzen',
    lines: [
      hallo(),
      '',
      'über diesen Link kannst du ein neues Passwort festlegen:',
      link,
      '',
      'Der Link ist 1 Stunde gültig. Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.',
    ],
  }),
  pendingSignup: (who, approveUrl) => ({
    subject: 'Neues Konto wartet auf Freigabe',
    lines: [
      hallo(),
      '',
      `${who} hat sich registriert und wartet auf deine Freigabe.`,
      ...(approveUrl ? ['', `Freigeben: ${approveUrl}`] : []),
    ],
  }),
  twoFactorCode: (code) => ({
    subject: 'Dein Bestätigungscode',
    lines: [
      hallo(),
      '',
      `dein Bestätigungscode lautet: ${code}`,
      '',
      'Der Code ist 10 Minuten gültig. Wenn du das nicht warst, ändere bitte dein Passwort.',
    ],
  }),
  testMail: () => ({
    subject: 'Test-E-Mail',
    lines: ['Diese Test-E-Mail bestätigt, dass der E-Mail-Versand funktioniert.'],
  }),

  registrationReceived: (title, project) => ({
    subject: 'Anmeldung eingegangen',
    lines: [
      hallo(),
      '',
      `deine Anmeldung „${title}“ für ${project} ist eingegangen. Vielen Dank!`,
      'Wenn du dich nicht angemeldet hast, kannst du diese E-Mail ignorieren.',
    ],
  }),
  checkinConfirmed: (event, project, when, excused) => ({
    subject: 'Check-in bestätigt',
    lines: [
      hallo(),
      '',
      `dein Check-in für „${event}“ (${project}${when ? `, ${when}` : ''}) wurde erfasst.`,
      `Status: ${excused ? 'entschuldigt' : 'anwesend'}`,
      'Wenn du das nicht warst, wende dich bitte an die Projektleitung.',
    ],
  }),
  welcome: (app, approved, loginUrl) => ({
    subject: 'Willkommen',
    lines: [
      hallo(),
      '',
      `dein Konto bei ${app} ist eingerichtet.`,
      approved
        ? `Du kannst dich jetzt anmelden${loginUrl ? `: ${loginUrl}` : '.'}`
        : 'Ein Admin muss es noch freigeben. Danach kannst du dich anmelden.',
    ],
  }),

  reminder: (name, event, project, when) => ({
    subject: `Erinnerung: ${event}`,
    lines: [hallo(name), '', `bald ist ${event} (${project}):`, when],
    after: 'Falls du nicht kommen kannst, gib bitte rechtzeitig Bescheid.',
  }),
  statusChanged: (name, event, project, when, excused) => ({
    subject: `Anwesenheit geändert: ${event}`,
    lines: [
      hallo(name),
      '',
      `du wurdest für ${event} (${project}${when ? `, ${when}` : ''}) als ${excused ? 'entschuldigt' : 'abwesend'} eingetragen.`,
      '',
      'Falls das nicht stimmt, wende dich bitte an die Projektleitung.',
    ],
  }),
  weekly: (name) => ({
    subject: 'Deine Proben diese Woche',
    lines: [hallo(name), '', 'diese Woche stehen an:'],
  }),
  weeklyExcused: 'entschuldigt',
  weeklyPresent: 'als anwesend eingetragen',

  formCopy: (title: string, answers: string[]) => ({
    subject: `Deine Antwort: ${title}`,
    lines: [hallo(), '', `danke für deine Antwort auf „${title}“. Deine Angaben:`, '', ...answers],
  }),
  formResponseNotice: (title: string, total: number, link: string | null) => ({
    subject: `Neue Antwort: ${title}`,
    lines: [hallo(), '', `„${title}“ hat eine neue Antwort erhalten (${total} insgesamt).`, ...(link ? ['', link] : [])],
  }),
  formDigest: (title: string, added: number, total: number, link: string | null) => ({
    subject: `${added} neue Antworten: ${title}`,
    lines: [hallo(), '', `„${title}“ hat ${added} neue Antworten erhalten (${total} insgesamt).`, ...(link ? ['', link] : [])],
  }),
  formYes: 'Ja',
  formNo: 'Nein',
  formFiles: (n: number) => (n === 1 ? '1 Datei' : `${n} Dateien`),
};

export default de;
