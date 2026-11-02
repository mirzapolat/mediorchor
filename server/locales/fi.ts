// Suomenkieliset sähköpostitekstit. Rakenne kuten en.ts:ssä.

import type { MailTexts } from './en.ts';

const hei = (name?: string) => (name ? `Hei ${name},` : 'Hei,');

const fi: MailTexts = {
  time: (time) => `klo ${time.replace(':', '.')}`,
  autoSent: 'Tämä sähköposti lähetettiin automaattisesti.',
  notificationFooter: 'Saat tämän sähköpostin, koska olet ottanut ilmoitukset käyttöön tililläsi.',

  confirmSignup: (link) => ({
    subject: 'Vahvista sähköpostiosoitteesi',
    lines: [hei(), '', 'vahvista sähköpostiosoitteesi tämän linkin kautta:', link, '', 'Linkki on voimassa 24 tuntia.'],
  }),
  confirmEmailChange: (link) => ({
    subject: 'Vahvista uusi sähköpostiosoitteesi',
    lines: [hei(), '', 'vahvista uusi sähköpostiosoitteesi tämän linkin kautta:', link, '', 'Linkki on voimassa 24 tuntia.'],
  }),
  passwordReset: (link) => ({
    subject: 'Salasanan palautus',
    lines: [
      hei(),
      '',
      'voit valita uuden salasanan tämän linkin kautta:',
      link,
      '',
      'Linkki on voimassa 1 tunnin. Jos et pyytänyt tätä, voit jättää tämän viestin huomiotta.',
    ],
  }),
  twoFactorCode: (code) => ({
    subject: 'Vahvistuskoodisi',
    lines: [
      hei(),
      '',
      `vahvistuskoodisi on: ${code}`,
      '',
      'Koodi on voimassa 10 minuuttia. Jos et itse pyytänyt sitä, vaihda salasanasi.',
    ],
  }),
  testMail: () => ({
    subject: 'Testiviesti',
    lines: ['Tämä testiviesti vahvistaa, että sähköpostin lähetys toimii.'],
  }),

  registrationReceived: (title, project) => ({
    subject: 'Ilmoittautuminen vastaanotettu',
    lines: [
      hei(),
      '',
      `ilmoittautumisesi ”${title}” projektiin ${project} on vastaanotettu. Kiitos!`,
      'Jos et ilmoittautunut, voit jättää tämän viestin huomiotta.',
    ],
  }),
  checkinConfirmed: (event, project, when, excused) => ({
    subject: 'Kuittaus vahvistettu',
    lines: [
      hei(),
      '',
      `kuittauksesi harjoitukseen ”${event}” (${project}${when ? `, ${when}` : ''}) on kirjattu.`,
      `Tila: ${excused ? 'ilmoitettu poissaolo' : 'paikalla'}`,
      'Jos et itse kuitannut, ota yhteyttä projektin vetäjiin.',
    ],
  }),
  welcome: (app, approved, loginUrl) => ({
    subject: 'Tervetuloa',
    lines: [
      hei(),
      '',
      `tilisi palveluun ${app} on luotu.`,
      approved
        ? `Voit nyt kirjautua sisään${loginUrl ? `: ${loginUrl}` : '.'}`
        : 'Ylläpitäjän on vielä hyväksyttävä se. Sen jälkeen voit kirjautua sisään.',
    ],
  }),

  reminder: (name, event, project, when) => ({
    subject: `Muistutus: ${event}`,
    lines: [hei(name), '', `pian on vuorossa ${event} (${project}):`, when],
    after: 'Jos et pääse paikalle, ilmoita siitä ajoissa.',
  }),
  statusChanged: (name, event, project, when, excused) => ({
    subject: `Läsnäolo muuttunut: ${event}`,
    lines: [
      hei(name),
      '',
      `sinut on merkitty ${excused ? 'ilmoitetusti poissaolevaksi' : 'poissaolevaksi'}: ${event} (${project}${when ? `, ${when}` : ''}).`,
      '',
      'Jos tämä ei pidä paikkaansa, ota yhteyttä projektin vetäjiin.',
    ],
  }),
  weekly: (name) => ({
    subject: 'Harjoituksesi tällä viikolla',
    lines: [hei(name), '', 'Tällä viikolla:'],
  }),
  weeklyExcused: 'ilmoitettu poissaolo',
  weeklyPresent: 'merkitty paikalla olevaksi',

  formCopy: (title: string, answers: string[]) => ({
    subject: `Vastauksesi: ${title}`,
    lines: [hei(), '', `kiitos vastauksestasi kyselyyn ”${title}”. Vastauksesi:`, '', ...answers],
  }),
  formResponseNotice: (title: string, total: number, link: string | null) => ({
    subject: `Uusi vastaus: ${title}`,
    lines: [hei(), '', `”${title}” sai uuden vastauksen (yhteensä ${total}).`, ...(link ? ['', link] : [])],
  }),
  formDigest: (title: string, added: number, total: number, link: string | null) => ({
    subject: `${added} uutta vastausta: ${title}`,
    lines: [hei(), '', `”${title}” sai ${added} uutta vastausta (yhteensä ${total}).`, ...(link ? ['', link] : [])],
  }),
  formYes: 'Kyllä',
  formNo: 'Ei',
  formFiles: (n: number) => (n === 1 ? '1 tiedosto' : `${n} tiedostoa`),

  greeting: hei,
  notificationEmailFooter: (settings: string | null) =>
    `Saat tämän sähköpostin, koska valitsit sähköpostin tälle ilmoitukselle.${settings ? ` Muuta: ${settings}` : ''}`,
  roleNames: {
    participant: 'Osallistuja',
    section_lead: 'Stemmanjohtaja',
    manager: 'Hallinto',
    music_director: 'Musiikillinen johtaja',
    admin: 'Ylläpitäjä',
  },
  notify: {
    event_reminder: (event, project, when) => ({ title: `Muistutus: ${event}`, body: `${when} · ${project}` }),
    event_new: (n, event, project, when) =>
      n === 1
        ? { title: `Uusi harjoitus: ${event}`, body: `${when} · ${project}` }
        : { title: `${n} uutta harjoitusta`, body: project },
    event_changed: (event, project, when, location) => ({
      title: `Harjoitus muuttui: ${event}`,
      body: `Nyt ${when}${location ? `, ${location}` : ''} · ${project}`,
    }),
    event_cancelled: (event, project, when) => ({ title: `Harjoitus peruttu: ${event}`, body: `${when} · ${project}` }),
    attendance_changed: (event, project, when, excused) => ({
      title: excused ? `Sinut merkittiin poissaolevaksi luvalla: ${event}` : `Merkitty poissaolevaksi: ${event}`,
      body: `${when} · ${project}`,
    }),
    weekly_overview: (lines) => ({ title: 'Harjoituksesi tällä viikolla', body: lines.join('\n') }),
    project_added: (project) => ({
      title: `Sinut lisättiin projektiin ${project}`,
      body: 'Harjoitukset, kappaleet ja muut löytyvät projektista.',
    }),
    project_info: (project) => ({ title: `Uutta: ${project}`, body: 'Projektin tiedot päivitettiin.' }),
    piece_added: (n, piece, project) =>
      n === 1 ? { title: `Uusi kappale: ${piece}`, body: project } : { title: `${n} uutta kappaletta`, body: project },
    concert_published: (concert, project, when) => ({ title: `Konsertti: ${concert}`, body: `${when} · ${project}` }),
    weekend_published: (weekend, project, when) => ({
      title: `Harjoitusviikonloppu: ${weekend}`,
      body: when ? `${when} · ${project}` : project,
    }),
    weekend_rooms: (weekend, project) => ({ title: `Valitse huone: ${weekend}`, body: project }),
    survey_new: (survey, project, closes) => ({
      title: `Uusi kysely: ${survey}`,
      body: closes ? `${closes} asti · ${project}` : project,
    }),
    survey_deadline: (survey, project, closes) => ({
      title: `Kysely sulkeutuu pian: ${survey}`,
      body: `${closes} asti · ${project}`,
    }),
    registration_new: (n, page, project) => ({
      title: n === 1 ? `Uusi ilmoittautuminen: ${page}` : `${n} uutta ilmoittautumista: ${page}`,
      body: project,
    }),
    checkin_unrecognized: (n, event, project) => ({
      title: n === 1 ? `Tunnistamaton kirjautuminen: ${event}` : `${n} tunnistamatonta kirjautumista: ${event}`,
      body: project,
    }),
    group_absence: (names, event, when, group) => ({
      title: names.length === 1 ? `${names[0]} on poissa luvalla: ${event}` : `${names.length} poissa luvalla: ${event}`,
      body: `${when} · ${group}${names.length > 1 ? ` · ${names.join(', ')}` : ''}`,
    }),
    signup_pending: (names) => ({
      title: names.length === 1 ? `Tili odottaa hyväksyntää: ${names[0]}` : `${names.length} tiliä odottaa hyväksyntää`,
      body: names.length > 1 ? names.join(', ') : 'Hyväksy tai hylkää käyttäjäluettelossa.',
    }),
    account_role: (role) => ({ title: `Roolisi on nyt ${role}`, body: 'Se, mitä voit nähdä ja muokata, muuttui.' }),
    security_login: (device, when) => ({
      title: 'Uusi kirjautuminen tilillesi',
      body: `${device} · ${when}. Etkö se ollut sinä? Vaihda salasanasi ja kirjaa laite ulos.`,
    }),
    security_change: (what) => ({
      title: {
        password: 'Salasanasi vaihdettiin',
        email: 'Sähköpostiosoitteesi vaihdettiin',
        mfa_added: 'Kirjautumistapa lisättiin',
        mfa_removed: 'Kirjautumistapa poistettiin',
      }[what],
      body: 'Jos se et ollut sinä, vaihda salasanasi heti.',
    }),
  },
  unknownDevice: 'Tuntematon laite',
};

export default fi;
