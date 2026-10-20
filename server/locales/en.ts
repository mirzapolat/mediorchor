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
  pendingSignup: (who: string, approveUrl: string | null) => ({
    subject: 'New account awaiting approval',
    lines: [
      hello(),
      '',
      `${who} signed up and is waiting for your approval.`,
      ...(approveUrl ? ['', `Approve: ${approveUrl}`] : []),
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
};

export type MailTexts = typeof en;

export default en;
