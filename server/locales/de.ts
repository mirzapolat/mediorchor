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

  greeting: hallo,
  notificationEmailFooter: (settings: string | null) =>
    `Du erhältst diese E-Mail, weil du für diese Benachrichtigung E-Mail gewählt hast.${settings ? ` Ändern: ${settings}` : ''}`,
  roleNames: {
    participant: 'Teilnehmer',
    section_lead: 'Stimmeltern',
    manager: 'Verwaltung',
    music_director: 'Musikalische Leitung',
    admin: 'Admin',
  },
  notify: {
    event_reminder: (event, project, when) => ({ title: `Erinnerung: ${event}`, body: `${when} · ${project}` }),
    event_new: (n, event, project, when) =>
      n === 1
        ? { title: `Neue Probe: ${event}`, body: `${when} · ${project}` }
        : { title: `${n} neue Proben`, body: project },
    event_changed: (event, project, when, location) => ({
      title: `Probe geändert: ${event}`,
      body: `Jetzt ${when}${location ? `, ${location}` : ''} · ${project}`,
    }),
    event_cancelled: (event, project, when) => ({ title: `Probe entfällt: ${event}`, body: `${when} · ${project}` }),
    attendance_changed: (event, project, when, excused) => ({
      title: excused ? `Du wurdest entschuldigt: ${event}` : `Als abwesend eingetragen: ${event}`,
      body: `${when} · ${project}`,
    }),
    weekly_overview: (lines) => ({ title: 'Deine Proben diese Woche', body: lines.join('\n') }),
    project_added: (project) => ({
      title: `Du bist jetzt in ${project}`,
      body: 'Proben, Stücke und mehr findest du im Projekt.',
    }),
    project_info: (project) => ({ title: `Neues in ${project}`, body: 'Die Projektinfo wurde aktualisiert.' }),
    piece_added: (n, piece, project) =>
      n === 1 ? { title: `Neues Stück: ${piece}`, body: project } : { title: `${n} neue Stücke`, body: project },
    concert_published: (concert, project, when) => ({ title: `Konzert: ${concert}`, body: `${when} · ${project}` }),
    weekend_published: (weekend, project, when) => ({
      title: `Probenwochenende: ${weekend}`,
      body: when ? `${when} · ${project}` : project,
    }),
    weekend_rooms: (weekend, project) => ({ title: `Zimmer wählen: ${weekend}`, body: project }),
    survey_new: (survey, project, closes) => ({
      title: `Neue Umfrage: ${survey}`,
      body: closes ? `Bis ${closes} · ${project}` : project,
    }),
    survey_deadline: (survey, project, closes) => ({
      title: `Umfrage endet bald: ${survey}`,
      body: `Bis ${closes} · ${project}`,
    }),
    registration_new: (n, page, project) => ({
      title: n === 1 ? `Neue Anmeldung: ${page}` : `${n} neue Anmeldungen: ${page}`,
      body: project,
    }),
    checkin_unrecognized: (n, event, project) => ({
      title: n === 1 ? `Unerkannter Check-in: ${event}` : `${n} unerkannte Check-ins: ${event}`,
      body: project,
    }),
    group_absence: (names, event, when, group) => ({
      title: names.length === 1 ? `${names[0]} ist entschuldigt: ${event}` : `${names.length} entschuldigt: ${event}`,
      body: `${when} · ${group}${names.length > 1 ? ` · ${names.join(', ')}` : ''}`,
    }),
    signup_pending: (names) => ({
      title: names.length === 1 ? `Konto wartet auf Freigabe: ${names[0]}` : `${names.length} Konten warten auf Freigabe`,
      body: names.length > 1 ? names.join(', ') : 'Freigeben oder ablehnen in der Benutzerliste.',
    }),
    account_role: (role) => ({ title: `Deine Rolle ist jetzt ${role}`, body: 'Damit hat sich geändert, was du sehen und bearbeiten kannst.' }),
    security_login: (device, when) => ({
      title: 'Neue Anmeldung bei deinem Konto',
      body: `${device} · ${when}. Nicht du? Ändere dein Passwort und melde das Gerät ab.`,
    }),
    security_change: (what) => ({
      title: {
        password: 'Dein Passwort wurde geändert',
        email: 'Deine E-Mail-Adresse wurde geändert',
        mfa_added: 'Eine Anmeldemethode wurde hinzugefügt',
        mfa_removed: 'Eine Anmeldemethode wurde entfernt',
      }[what],
      body: 'Warst du das nicht, ändere sofort dein Passwort.',
    }),
  },
  unknownDevice: 'Unbekanntes Gerät',
};

export default de;
