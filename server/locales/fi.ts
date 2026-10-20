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
  pendingSignup: (who, approveUrl) => ({
    subject: 'Uusi tili odottaa hyväksyntää',
    lines: [
      hei(),
      '',
      `${who} on rekisteröitynyt ja odottaa hyväksyntääsi.`,
      ...(approveUrl ? ['', `Hyväksy: ${approveUrl}`] : []),
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
};

export default fi;
