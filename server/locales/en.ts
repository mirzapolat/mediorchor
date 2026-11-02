// English email texts. This file defines the shape: every other language in
// server/locales must provide all of it (TypeScript checks it). The greeting,
// subject and body of each email; the app name is prefixed to subjects.

const hello = (name?: string) => (name ? `Hello ${name},` : 'Hello,');

const en = {
  // A time of day after a date, e.g. "Monday, 6 October, 19:00".
  time: (time: string) => time,
  autoSent: 'This email was sent automatically.',
  notificationFooter: 'You receive this email because you turned on notifications in your account.',

  confirmSignup: (link: string) => ({
    subject: 'Confirm your email',
    lines: [hello(), '', 'please confirm your email address using this link:', link, '', 'The link is valid for 24 hours.'],
  }),
  confirmEmailChange: (link: string) => ({
    subject: 'Confirm your new email',
    lines: [hello(), '', 'please confirm your new email address using this link:', link, '', 'The link is valid for 24 hours.'],
  }),
  passwordReset: (link: string) => ({
    subject: 'Reset your password',
    lines: [
      hello(),
      '',
      'you can choose a new password using this link:',
      link,
      '',
      'The link is valid for 1 hour. If you didn’t ask for this, you can ignore this email.',
    ],
  }),
  twoFactorCode: (code: string) => ({
    subject: 'Your verification code',
    lines: [
      hello(),
      '',
      `your verification code is: ${code}`,
      '',
      'The code is valid for 10 minutes. If this wasn’t you, please change your password.',
    ],
  }),
  testMail: () => ({
    subject: 'Test email',
    lines: ['This test email confirms that sending email works.'],
  }),

  registrationReceived: (title: string, project: string) => ({
    subject: 'Registration received',
    lines: [
      hello(),
      '',
      `your registration "${title}" for ${project} has been received. Thank you!`,
      'If you didn’t register, you can ignore this email.',
    ],
  }),
  checkinConfirmed: (event: string, project: string, when: string, excused: boolean) => ({
    subject: 'Check-in confirmed',
    lines: [
      hello(),
      '',
      `your check-in for "${event}" (${project}${when ? `, ${when}` : ''}) was recorded.`,
      `Status: ${excused ? 'excused' : 'present'}`,
      'If this wasn’t you, please contact the project’s organisers.',
    ],
  }),
  welcome: (app: string, approved: boolean, loginUrl: string | null) => ({
    subject: 'Welcome',
    lines: [
      hello(),
      '',
      `your ${app} account is set up.`,
      approved
        ? `You can sign in now${loginUrl ? `: ${loginUrl}` : '.'}`
        : 'An admin still has to approve it. You can sign in after that.',
    ],
  }),

  reminder: (name: string, event: string, project: string, when: string) => ({
    subject: `Reminder: ${event}`,
    lines: [hello(name), '', `${event} (${project}) is coming up:`, when],
    after: "If you can't make it, please let us know in time.",
  }),
  statusChanged: (name: string, event: string, project: string, when: string, excused: boolean) => ({
    subject: `Attendance changed: ${event}`,
    lines: [
      hello(name),
      '',
      `you were marked ${excused ? 'excused' : 'absent'} for ${event} (${project}${when ? `, ${when}` : ''}).`,
      '',
      "If that's not right, please contact the project management.",
    ],
  }),
  weekly: (name: string) => ({
    subject: 'Your rehearsals this week',
    lines: [hello(name), '', 'This week:'],
  }),
  weeklyExcused: 'excused',
  weeklyPresent: 'marked present',

  // Surveys: a copy for the respondent, and notices for managers that never
  // contain answers or names.
  formCopy: (title: string, answers: string[]) => ({
    subject: `Your response: ${title}`,
    lines: [hello(), '', `thank you for your response to "${title}". Your answers:`, '', ...answers],
  }),
  formResponseNotice: (title: string, total: number, link: string | null) => ({
    subject: `New response: ${title}`,
    lines: [hello(), '', `"${title}" received a new response (${total} in total).`, ...(link ? ['', link] : [])],
  }),
  formDigest: (title: string, added: number, total: number, link: string | null) => ({
    subject: `${added} new responses: ${title}`,
    lines: [hello(), '', `"${title}" received ${added} new responses (${total} in total).`, ...(link ? ['', link] : [])],
  }),
  formYes: 'Yes',
  formNo: 'No',
  formFiles: (n: number) => (n === 1 ? '1 file' : `${n} files`),

  // Notification center (shared/notifications.ts): title and one short body
  // per category; emails add a greeting, the link and the footer.
  greeting: hello,
  notificationEmailFooter: (settings: string | null) =>
    `You receive this email because you chose email for this kind of notification.${settings ? ` Change it: ${settings}` : ''}`,
  roleNames: {
    participant: 'Participant',
    section_lead: 'Section lead',
    manager: 'Management',
    music_director: 'Music director',
    admin: 'Admin',
  } as Record<string, string>,
  notify: {
    event_reminder: (event: string, project: string, when: string) => ({
      title: `Reminder: ${event}`,
      body: `${when} · ${project}`,
    }),
    event_new: (n: number, event: string, project: string, when: string) =>
      n === 1
        ? { title: `New rehearsal: ${event}`, body: `${when} · ${project}` }
        : { title: `${n} new rehearsals`, body: project },
    event_changed: (event: string, project: string, when: string, location: string | null) => ({
      title: `Rehearsal changed: ${event}`,
      body: `Now ${when}${location ? `, ${location}` : ''} · ${project}`,
    }),
    event_cancelled: (event: string, project: string, when: string) => ({
      title: `Rehearsal cancelled: ${event}`,
      body: `${when} · ${project}`,
    }),
    attendance_changed: (event: string, project: string, when: string, excused: boolean) => ({
      title: excused ? `You were excused: ${event}` : `Marked absent: ${event}`,
      body: `${when} · ${project}`,
    }),
    weekly_overview: (lines: string[]) => ({
      title: 'Your rehearsals this week',
      body: lines.join('\n'),
    }),
    project_added: (project: string) => ({
      title: `You were added to ${project}`,
      body: 'Rehearsals, pieces and more are now in the project.',
    }),
    project_info: (project: string) => ({
      title: `News in ${project}`,
      body: 'The project info was updated.',
    }),
    piece_added: (n: number, piece: string, project: string) =>
      n === 1 ? { title: `New piece: ${piece}`, body: project } : { title: `${n} new pieces`, body: project },
    concert_published: (concert: string, project: string, when: string) => ({
      title: `Concert: ${concert}`,
      body: `${when} · ${project}`,
    }),
    weekend_published: (weekend: string, project: string, when: string) => ({
      title: `Rehearsal weekend: ${weekend}`,
      body: when ? `${when} · ${project}` : project,
    }),
    weekend_rooms: (weekend: string, project: string) => ({
      title: `Choose your room: ${weekend}`,
      body: project,
    }),
    survey_new: (survey: string, project: string, closes: string | null) => ({
      title: `New survey: ${survey}`,
      body: closes ? `Until ${closes} · ${project}` : project,
    }),
    survey_deadline: (survey: string, project: string, closes: string) => ({
      title: `Survey closes soon: ${survey}`,
      body: `Until ${closes} · ${project}`,
    }),
    registration_new: (n: number, page: string, project: string) => ({
      title: n === 1 ? `New sign-up: ${page}` : `${n} new sign-ups: ${page}`,
      body: project,
    }),
    checkin_unrecognized: (n: number, event: string, project: string) => ({
      title: n === 1 ? `Unrecognised check-in: ${event}` : `${n} unrecognised check-ins: ${event}`,
      body: project,
    }),
    group_absence: (names: string[], event: string, when: string, group: string) => ({
      title:
        names.length === 1 ? `${names[0]} is excused: ${event}` : `${names.length} excused: ${event}`,
      body: `${when} · ${group}${names.length > 1 ? ` · ${names.join(', ')}` : ''}`,
    }),
    signup_pending: (names: string[]) => ({
      title: names.length === 1 ? `Account waiting for approval: ${names[0]}` : `${names.length} accounts waiting for approval`,
      body: names.length > 1 ? names.join(', ') : 'Approve or reject it in the user list.',
    }),
    account_role: (role: string) => ({
      title: `Your role is now ${role}`,
      body: 'What you can see and edit changed with it.',
    }),
    security_login: (device: string, when: string) => ({
      title: 'New sign-in to your account',
      body: `${device} · ${when}. Not you? Change your password and sign out the device.`,
    }),
    security_change: (what: 'password' | 'email' | 'mfa_added' | 'mfa_removed') => ({
      title: {
        password: 'Your password was changed',
        email: 'Your email address was changed',
        mfa_added: 'A sign-in method was added',
        mfa_removed: 'A sign-in method was removed',
      }[what],
      body: "If that wasn't you, change your password right away.",
    }),
  },
  unknownDevice: 'Unknown device',
};

export type MailTexts = typeof en;

export default en;
