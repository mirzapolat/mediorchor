import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LANGUAGE, type Language } from './config';

// Minimal in-app i18n. The default language comes from VITE_DEFAULT_LANGUAGE but
// the user can switch at runtime; the choice is persisted to localStorage.

type Dict = Record<string, { de: string; en: string }>;

const dict: Dict = {
  // Generic
  signIn: { de: 'Anmelden', en: 'Sign in' },
  signOut: { de: 'Abmelden', en: 'Sign out' },
  email: { de: 'E-Mail', en: 'Email' },
  password: { de: 'Passwort', en: 'Password' },
  name: { de: 'Name', en: 'Name' },
  save: { de: 'Speichern', en: 'Save' },
  cancel: { de: 'Abbrechen', en: 'Cancel' },
  create: { de: 'Erstellen', en: 'Create' },
  edit: { de: 'Bearbeiten', en: 'Edit' },
  delete: { de: 'Löschen', en: 'Delete' },
  archive: { de: 'Archivieren', en: 'Archive' },
  add: { de: 'Hinzufügen', en: 'Add' },
  close: { de: 'Schließen', en: 'Close' },
  search: { de: 'Suchen', en: 'Search' },
  all: { de: 'Alle', en: 'All' },
  active: { de: 'Aktiv', en: 'Active' },
  status: { de: 'Status', en: 'Status' },
  timeframe: { de: 'Zeitraum', en: 'Timeframe' },
  upcoming: { de: 'Bevorstehend', en: 'Upcoming' },
  past: { de: 'Vergangen', en: 'Past' },
  noResults: { de: 'Keine Ergebnisse', en: 'No results' },
  loading: { de: 'Lädt…', en: 'Loading…' },
  confirm: { de: 'Bestätigen', en: 'Confirm' },
  optional: { de: 'optional', en: 'optional' },
  back: { de: 'Zurück', en: 'Back' },
  actions: { de: 'Aktionen', en: 'Actions' },
  clearFilters: { de: 'Zurücksetzen', en: 'Reset' },
  searchAndFilter: { de: 'Suchen & filtern', en: 'Search & filter' },
  collapse: { de: 'Einklappen', en: 'Collapse' },
  deleteAccount: { de: 'Konto löschen', en: 'Delete account' },
  deleteAccountHint: {
    de: 'Dein Konto und deine Anmeldedaten werden endgültig gelöscht. Deine bisherige Anwesenheit in Projekten bleibt als Mitgliedseintrag erhalten, ist aber nicht mehr mit einem Konto verbunden.',
    en: 'Your account and sign-in are permanently deleted. Your attendance history in projects stays as member entries, no longer connected to an account.',
  },
  deleteAccountConfirm: {
    de: 'Das kann nicht rückgängig gemacht werden. Gib zur Bestätigung dein Passwort ein.',
    en: 'This cannot be undone. Enter your password to confirm.',
  },
  deleteAccountWrongPassword: { de: 'Das Passwort ist falsch.', en: 'The password is incorrect.' },
  deleteAccountConfirm2fa: {
    de: 'Das kann nicht rückgängig gemacht werden. Gib zur Bestätigung dein Passwort und einen aktuellen Code aus deiner Authenticator-App ein.',
    en: 'This cannot be undone. Enter your password and a current code from your authenticator app to confirm.',
  },
  deleteAccountCode: { de: 'Code aus der Authenticator-App', en: 'Authenticator code' },
  deleteAccountWrongCode: { de: 'Der Code ist falsch oder abgelaufen.', en: 'The code is incorrect or expired.' },
  deleteAccountLastAdmin: {
    de: 'Du bist der letzte Administrator. Ernenne zuerst jemand anderen zum Administrator.',
    en: 'You are the last administrator. Make someone else an administrator first.',
  },
  expand: { de: 'Ausklappen', en: 'Expand' },
  remove: { de: 'Entfernen', en: 'Remove' },
  reorder: { de: 'Verschieben', en: 'Reorder' },
  target: { de: 'Ziel', en: 'Target' },
  bold: { de: 'Fett', en: 'Bold' },
  italic: { de: 'Kursiv', en: 'Italic' },
  heading: { de: 'Überschrift', en: 'Heading' },
  bulletList: { de: 'Liste', en: 'List' },
  link: { de: 'Link', en: 'Link' },
  write: { de: 'Schreiben', en: 'Write' },
  nothingToPreview: { de: 'Nichts zur Vorschau', en: 'Nothing to preview' },

  // Nav
  projects: { de: 'Projekte', en: 'Projects' },
  comingSoon: { de: 'Demnächst verfügbar', en: 'Coming soon' },
  users: { de: 'Benutzer', en: 'Users' },
  adminConfig: { de: 'Admin Config', en: 'Admin Config' },
  adminSettings: { de: 'Admin-Einstellungen', en: 'Admin settings' },
  settings: { de: 'Einstellungen', en: 'Settings' },
  configuration: { de: 'Konfiguration', en: 'Configuration' },
  account: { de: 'Konto', en: 'Account' },
  events: { de: 'Proben', en: 'Events' },
  members: { de: 'Mitglieder', en: 'Members' },
  absences: { de: 'Fehlzeiten', en: 'Absences' },
  statistics: { de: 'Anwesenheit', en: 'Attendance' },
  checkIn: { de: 'Check-in', en: 'Check-in' },

  // Auth
  loginTitle: { de: 'Willkommen zurück', en: 'Welcome back' },
  loginSubtitle: { de: 'Melde dich bei deinem Konto an', en: 'Sign in to your account' },
  invalidCredentials: { de: 'Ungültige Anmeldedaten', en: 'Invalid credentials' },
  signUp: { de: 'Konto erstellen', en: 'Create account' },
  signUpTitle: { de: 'Konto erstellen', en: 'Create an account' },
  signUpSubtitle: {
    de: 'Erstelle ein Konto, um deine Teilnahme zu verwalten',
    en: 'Create an account to manage your participation',
  },
  confirmEmailTitle: { de: 'Bestätige deine E-Mail', en: 'Confirm your email' },
  confirmEmailHint: {
    de: 'Wir haben dir einen Bestätigungslink geschickt. Öffne die E-Mail und bestätige deine Adresse, um dich anzumelden.',
    en: 'We sent you a confirmation link. Open the email and confirm your address to sign in.',
  },
  haveAccount: { de: 'Du hast bereits ein Konto?', en: 'Already have an account?' },
  noAccount: { de: 'Noch kein Konto?', en: "Don't have an account?" },

  // Projects
  newProject: { de: 'Neues Projekt', en: 'New project' },
  editProject: { de: 'Projekt bearbeiten', en: 'Edit project' },
  projectName: { de: 'Projektname', en: 'Project name' },
  description: { de: 'Beschreibung', en: 'Description' },
  noProjects: { de: 'Noch keine Projekte', en: 'No projects yet' },
  projectImage: { de: 'Projektbild', en: 'Project image' },
  archived: { de: 'Archiviert', en: 'Archived' },

  // Users
  newUser: { de: 'Neuer Benutzer', en: 'New user' },
  owner: { de: 'Admin', en: 'Admin' },
  member: { de: 'Mitglied', en: 'Member' },
  role: { de: 'Rolle', en: 'Role' },
  deleteUser: { de: 'Benutzer löschen', en: 'Delete user' },
  confirmDeleteUser: {
    de: 'Diesen Benutzer endgültig löschen? Der Zugang wird sofort entzogen.',
    en: 'Permanently delete this user? Their access is revoked immediately.',
  },
  adminRights: { de: 'Administrator', en: 'Administrator' },
  adminRightsHint: {
    de: 'Voller Zugriff auf alles, inklusive Benutzerverwaltung.',
    en: 'Full access to everything, including user management.',
  },
  adminRightsSelfHint: {
    de: 'Du kannst deine eigenen Admin-Rechte nicht entziehen.',
    en: 'You cannot remove your own admin rights.',
  },
  projectManagement: { de: 'Projektverwaltung', en: 'Project management' },
  clubAccess: { de: 'Zugriff auf Vereinsmitglieder', en: 'Club members access' },
  clubAccessHint: {
    de: 'Wenn aktiv, kann dieser Benutzer die Vereinsmitglieder-Seite sehen und bearbeiten.',
    en: 'When on, this user can view and manage the club members section.',
  },
  accessAll: { de: 'Alle', en: 'All' },
  accessAllProjects: { de: 'Alle Projekte', en: 'All projects' },
  accessPartial: { de: 'Teilweise', en: 'Partial' },
  accessNone: { de: 'Nein', en: 'No' },
  memberManagement: { de: 'Mitgliederverwaltung', en: 'Member management' },
  clubShort: { de: 'Verein', en: 'Club' },
  accountCreated: { de: 'Erstellt', en: 'Created' },
  lastSeen: { de: 'Zuletzt aktiv', en: 'Last seen' },
  never: { de: 'Nie', en: 'Never' },
  yes: { de: 'Ja', en: 'Yes' },
  no: { de: 'Nein', en: 'No' },
  manageAccess: { de: 'Zugriff verwalten', en: 'Manage access' },
  allProjectsAccess: { de: 'Zugriff auf alle Projekte', en: 'Access to all projects' },
  allProjectsHint: {
    de: 'Wenn aktiv, kann dieser Benutzer alle aktuellen und zukünftigen Projekte verwalten und neue anlegen.',
    en: 'When on, this user can manage all current and future projects and create new ones.',
  },
  selectedProjects: { de: 'Einzelne Projekte', en: 'Specific projects' },
  selectedProjectsHint: {
    de: 'Dieser Benutzer kann die ausgewählten Projekte verwalten. Dieselbe Auswahl lässt sich auch pro Projekt auf der Projektseite bearbeiten.',
    en: 'This user can manage the selected projects. The same grants can also be edited per project on the projects page.',
  },
  projectAccessHint: {
    de: 'Ausgewählte Benutzer können dieses Projekt verwalten, ohne Zugriff auf andere Projekte zu erhalten.',
    en: 'Selected users can manage this project without getting access to other projects.',
  },
  coveredByAllProjects: { de: 'Hat bereits Zugriff auf alle Projekte', en: 'Already has access to all projects' },
  noProjectsGranted: { de: 'Keine', en: 'None' },
  projectSingular: { de: 'Projekt', en: 'project' },
  projectPlural: { de: 'Projekte', en: 'projects' },
  accessFor: { de: 'Zugriff für', en: 'Access for' },

  // Account
  twoFactor: { de: 'Zwei-Faktor-Authentifizierung', en: 'Two-factor authentication' },
  twoFactorShort: { de: '2FA', en: '2FA' },
  twoFactorOn: { de: 'aktiviert', en: 'enabled' },
  twoFactorOff: { de: 'nicht aktiviert', en: 'not enabled' },
  enable2fa: { de: '2FA aktivieren', en: 'Enable 2FA' },
  twoFactorCode: { de: 'Bestätigungscode', en: 'Verification code' },
  emailChangePending: {
    de: 'Gespeichert. Bitte bestätige die neue E-Mail-Adresse über den Link, den wir dir geschickt haben.',
    en: 'Saved. Please confirm the new email address using the link we sent you.',
  },
  twoFactorPrompt: {
    de: 'Gib den 6-stelligen Code aus deiner Authenticator-App ein.',
    en: 'Enter the 6-digit code from your authenticator app.',
  },
  disable2fa: { de: '2FA deaktivieren', en: 'Disable 2FA' },
  newPassword: { de: 'Neues Passwort', en: 'New password' },
  language: { de: 'Sprache', en: 'Language' },
  appearance: { de: 'Darstellung', en: 'Appearance' },
  appearanceHint: {
    de: 'Gilt für dieses Gerät. „System“ folgt der Einstellung deines Betriebssystems.',
    en: 'Applies to this device. “System” follows your operating system setting.',
  },
  themeLight: { de: 'Hell', en: 'Light' },
  themeDark: { de: 'Dunkel', en: 'Dark' },
  themeSystem: { de: 'System', en: 'System' },

  // Admin config
  allowSelfSignup: { de: 'Selbstregistrierung erlauben', en: 'Allow self-signup' },
  allowSelfSignupHint: {
    de: 'Wenn aktiv, können auf der Anmeldeseite eigene Konten erstellt werden.',
    en: 'When on, accounts can be created on the login page.',
  },

  // Settings

  // Members
  newMember: { de: 'Neues Mitglied', en: 'New member' },
  editMember: { de: 'Mitglied bearbeiten', en: 'Edit member' },
  firstName: { de: 'Vorname', en: 'First name' },
  lastName: { de: 'Nachname', en: 'Last name' },
  group: { de: 'Gruppe', en: 'Group' },
  photo: { de: 'Foto', en: 'Photo' },
  profilePhoto: { de: 'Profilbild', en: 'Profile photo' },
  profilePhotoHint: {
    de: 'Wird überall angezeigt, wo du als Mitglied erscheinst.',
    en: 'Shown wherever you appear as a member.',
  },
  uploadPhoto: { de: 'Bild hochladen', en: 'Upload photo' },
  changePhoto: { de: 'Bild ändern', en: 'Change photo' },
  cropPhoto: { de: 'Bild zuschneiden', en: 'Crop photo' },
  cropPhotoHint: {
    de: 'Verschiebe das Bild und zoome hinein, bis der Kreis passt.',
    en: 'Drag the photo and zoom until the circle fits.',
  },
  cropApply: { de: 'Übernehmen', en: 'Apply' },
  zoom: { de: 'Zoom', en: 'Zoom' },
  zoomIn: { de: 'Vergrößern', en: 'Zoom in' },
  zoomOut: { de: 'Verkleinern', en: 'Zoom out' },
  welcomePhotoTitle: { de: 'Willkommen, {name}!', en: 'Welcome, {name}!' },
  welcomePhotoHint: {
    de: 'Füge ein Profilbild hinzu, damit dich andere in Projekten und beim Check-in erkennen.',
    en: 'Add a profile photo so others recognise you in projects and at check-in.',
  },
  welcomePhotoDone: {
    de: 'Sieht gut aus! Du kannst dein Bild jederzeit in deinem Konto ändern.',
    en: 'Looks good! You can change your photo any time in your account.',
  },
  welcomePhotoChoose: { de: 'Profilbild auswählen', en: 'Choose a photo' },
  welcomePhotoLater: { de: 'Später', en: 'Later' },
  noMembers: { de: 'Noch keine Mitglieder', en: 'No members yet' },
  guest: { de: 'Gast', en: 'Guest' },
  searchAccount: { de: 'Konto suchen', en: 'Search account' },
  searchAccountPlaceholder: { de: 'Name oder E-Mail…', en: 'Name or email…' },
  searchAccountHint: {
    de: 'Wähle ein bestehendes Konto, um es als Mitglied hinzuzufügen — oder fülle die Felder unten aus, um ein Mitglied manuell zu erstellen.',
    en: 'Select an existing account to add it as a member — or fill in the fields below to create a member manually.',
  },
  noAccountsFound: {
    de: 'Kein passendes Konto gefunden. Das Mitglied wird manuell erstellt.',
    en: 'No matching account found. The member will be created manually.',
  },
  nameDiffersFromAccount: {
    de: 'Name weicht vom Konto ab',
    en: 'Name differs from account',
  },

  // CSV import
  importCsv: { de: 'CSV importieren', en: 'Import CSV' },
  importMembers: { de: 'Mitglieder importieren', en: 'Import members' },
  selectCsvFile: { de: 'CSV-Datei auswählen', en: 'Select CSV file' },
  dropzoneTitle: { de: 'Datei hierher ziehen oder klicken', en: 'Drop a file here or click to browse' },
  dropzoneRelease: { de: 'Loslassen zum Hochladen', en: 'Release to upload' },
  dropzoneHint: { de: 'Eine Datei auswählen', en: 'Choose one file' },
  dropzoneCsvHint: { de: 'CSV-Datei, z. B. ein Export aus Excel', en: 'CSV file, e.g. exported from Excel' },
  dropzoneReplace: { de: 'Klicken oder neue Datei ablegen, um sie zu ersetzen', en: 'Click or drop another file to replace it' },
  dropzoneWrongType: { de: 'Dieser Dateityp wird hier nicht unterstützt.', en: 'This file type is not supported here.' },
  firstRowHeader: {
    de: 'Erste Zeile enthält Spaltennamen',
    en: 'First row contains column names',
  },
  mapColumns: { de: 'Spalten zuordnen', en: 'Map columns' },
  preview: { de: 'Vorschau', en: 'Preview' },
  mapNotUsed: { de: 'Nicht verwenden', en: 'Not used' },
  mapAssign: { de: 'Attribut zuordnen', en: 'Assign attribute' },
  mapColumnsVisualHint: {
    de: 'Wähle über jeder Spalte, was sie enthält. Erkannte Spalten sind schon zugeordnet.',
    en: 'Choose above each column what it contains. Recognised columns are already assigned.',
  },
  mapNameRequired: {
    de: 'Ordne Vorname und Nachname zu – oder eine Spalte mit dem vollständigen Namen.',
    en: 'Assign first and last name – or one column with the full name.',
  },
  importResultPreview: { de: 'So werden die Mitglieder angelegt', en: 'How members will be created' },
  rowsReadyToImport: {
    de: '{n} von {total} Zeilen werden importiert',
    en: '{n} of {total} rows will be imported',
  },
  rowsSkippedHint: {
    de: 'Zeilen ohne Vor- und Nachname werden übersprungen.',
    en: 'Rows without a first and last name are skipped.',
  },
  rowsToUpdate: { de: '{n} werden aktualisiert', en: '{n} will be updated' },
  importDuplicates: { de: 'Bereits vorhanden', en: 'Already there' },
  importDuplicatesHint: {
    de: 'Gleiche E-Mail oder gleicher Vor- und Nachname (ohne abweichende E-Mail) gilt als dieselbe Person.',
    en: 'The same email, or the same first and last name without a different email, counts as the same person.',
  },
  importExistingMembers: {
    de: '{n} Zeilen passen zu bestehenden Mitgliedern',
    en: '{n} rows match existing members',
  },
  duplicateSkip: { de: 'Überspringen', en: 'Skip' },
  duplicateUpdate: {
    de: 'Bestehende aktualisieren (Gruppe, fehlende E-Mail, reaktivieren)',
    en: 'Update existing (group, missing email, re-activate)',
  },
  duplicateCreate: { de: 'Trotzdem neu anlegen', en: 'Create anyway' },
  importRepeatedRows: {
    de: '{n} Zeilen kommen in der Datei doppelt vor und werden übersprungen.',
    en: '{n} rows appear twice in the file and are skipped.',
  },
  newGroupsInImport: { de: 'Neue Gruppen', en: 'New groups' },
  newGroupsInImportHint: {
    de: 'Diese Gruppen gibt es im Projekt noch nicht. Wähle, wie sie übernommen werden sollen.',
    en: "These groups don't exist in the project yet. Choose how to handle them.",
  },
  createNewGroup: { de: 'Als neue Gruppe anlegen', en: 'Create as new group' },
  assignToGroup: { de: 'Zuordnen zu: {group}', en: 'Assign to: {group}' },
  removeGroupFromImport: { de: 'Entfernen (keine Gruppe)', en: 'Remove (no group)' },
  import: { de: 'Importieren', en: 'Import' },
  importing: { de: 'Importiere…', en: 'Importing…' },
  noRowsToImport: {
    de: 'Keine gültigen Zeilen zum Importieren.',
    en: 'No valid rows to import.',
  },
  emptyCsv: { de: 'Die Datei enthält keine Daten.', en: 'The file contains no data.' },
  andMore: { de: '… und {n} weitere', en: '… and {n} more' },

  // Events
  newEvent: { de: 'Neue Probe', en: 'New event' },
  editEvent: { de: 'Probe bearbeiten', en: 'Edit event' },
  eventName: { de: 'Probenname', en: 'Event name' },
  eventDescription: { de: 'Beschreibung', en: 'Description' },
  eventDescriptionPlaceholder: {
    de: 'z. B. Tutti, nur Streicher, Raum 2',
    en: 'e.g. tutti, strings only, room 2',
  },
  date: { de: 'Datum', en: 'Date' },
  time: { de: 'Uhrzeit', en: 'Time' },
  dateAndTime: { de: 'Datum & Uhrzeit', en: 'Date & time' },
  noEvents: { de: 'Noch keine Proben', en: 'No events yet' },
  nextRehearsal: { de: 'Nächste Probe', en: 'Next rehearsal' },
  todayRehearsal: { de: 'Heute', en: 'Today' },
  attendanceOverTime: { de: 'Anwesenheit über Zeit', en: 'Attendance over time' },
  averagePresent: { de: 'Ø Anwesend pro Probe', en: 'Avg. present per rehearsal' },
  totalAttendances: { de: 'Anwesenheiten gesamt', en: 'Total attendances' },
  totalExcuses: { de: 'Entschuldigungen gesamt', en: 'Total excuses' },
  attendanceRate: { de: 'Anwesenheitsquote', en: 'Attendance rate' },
  allGroups: { de: 'Alle Gruppen', en: 'All groups' },
  attendanceRateByGroup: { de: 'Anwesenheitsquote nach Gruppe', en: 'Attendance rate by group' },
  presentOfMembers: { de: '{n} von {total} anwesend', en: '{n} of {total} present' },
  attendanceChartHint: {
    de: 'Jede Säule ist eine Probe. Farbige Blöcke zeigen die Anwesenden je Gruppe, die Höhe der hellen Fläche die aktiven Mitglieder.',
    en: 'Each column is a rehearsal. Coloured blocks show who was present per group; the light track shows the active members.',
  },
  noStatistics: {
    de: 'Noch keine Daten. Lege Proben mit Datum an und erfasse die Anwesenheit.',
    en: 'No data yet. Add rehearsals with a date and record attendance.',
  },
  attendance: { de: 'Anwesenheit', en: 'Attendance' },
  attended: { de: 'Anwesend', en: 'Present' },
  excused: { de: 'Entschuldigt', en: 'Excused' },
  notAttended: { de: 'Abwesend', en: 'Absent' },
  total: { de: 'insgesamt', en: 'total' },
  addMemberToEvent: { de: 'Mitglied hinzufügen', en: 'Add member' },
  addAsGuest: { de: 'Als Gast hinzufügen', en: 'Add as guest' },
  addToProject: { de: 'Zum Projekt hinzufügen', en: 'Add to project' },
  guestOrMember: {
    de: 'Soll diese Person als Gast oder als Projektmitglied hinzugefügt werden?',
    en: 'Should this person be added as a guest or as a project member?',
  },
  absenceConditions: { de: 'Bedingungen', en: 'Conditions' },
  absenceConditionsHint: {
    de: 'Kombiniere Anwesenheitswerte mit UND oder ODER.',
    en: 'Combine attendance values with AND or OR.',
  },
  addCondition: { de: 'Bedingung hinzufügen', en: 'Add condition' },
  conditionMetric: { de: 'Wert', en: 'Metric' },
  comparison: { de: 'Vergleich', en: 'Comparison' },
  count: { de: 'Anzahl', en: 'Count' },
  when: { de: 'Wenn', en: 'When' },
  and: { de: 'UND', en: 'AND' },
  or: { de: 'ODER', en: 'OR' },
  atLeast: { de: 'mindestens', en: 'at least' },
  moreThan: { de: 'mehr als', en: 'more than' },
  exactly: { de: 'genau', en: 'exactly' },
  lessThan: { de: 'weniger als', en: 'less than' },
  atMost: { de: 'höchstens', en: 'at most' },
  matchingMembers: { de: 'Gefundene Mitglieder', en: 'Matching members' },
  saveAsLabel: { de: 'Als Label speichern', en: 'Save as label' },
  labelName: { de: 'Label-Name', en: 'Label name' },
  manageLabels: { de: 'Labels verwalten', en: 'Manage labels' },
  noLabels: { de: 'Noch keine Labels', en: 'No labels yet' },
  publicLabel: { de: 'Öffentlich', en: 'Public' },
  publicLabelHint: {
    de: 'Öffentliche Labels werden Teilnehmenden unter „Meine Teilnahme“ angezeigt, wenn sie auf sie zutreffen.',
    en: 'Public labels are shown to participants on "My participation" when they apply to them.',
  },
  noAbsenceResults: {
    de: 'Keine Mitglieder entsprechen diesen Bedingungen.',
    en: 'No members match these conditions.',
  },
  downloadCsv: { de: 'CSV herunterladen', en: 'Download CSV' },
  downloadPdf: { de: 'PDF herunterladen', en: 'Download PDF' },
  copyNameList: { de: 'Namensliste kopieren', en: 'Copy name list' },
  nameListCopied: { de: 'Namensliste wurde kopiert.', en: 'Name list copied.' },
  exportError: { de: 'Der Export ist fehlgeschlagen.', en: 'Export failed.' },
  configureCheckIn: { de: 'Check-in konfigurieren', en: 'Configure check-in' },
  checkInResult: { de: 'Status nach dem Check-in', en: 'Status after check-in' },
  showLogoInQr: { de: 'Projektbild im QR-Code anzeigen', en: 'Show project image in QR code' },
  showLogoInQrHint: {
    de: 'Das Projektbild wird in der Mitte des QR-Codes eingeblendet.',
    en: 'The project image is displayed in the centre of the QR code.',
  },
  startCheckIn: { de: 'Starten', en: 'Start' },
  stopCheckIn: { de: 'Stoppen', en: 'Stop' },
  checkInActive: { de: 'Check-in ist aktiv', en: 'Check-in is active' },
  checkInStopped: { de: 'Check-in ist gestoppt', en: 'Check-in is stopped' },
  checkInLinkHint: {
    de: 'Scanne den Code, um das öffentliche Formular zu öffnen.',
    en: 'Scan the code to open the public form.',
  },
  copyCheckInLink: { de: 'Link kopieren', en: 'Copy link' },
  copyQrImage: { de: 'Bild kopieren', en: 'Copy image' },
  showFullscreen: { de: 'Vollbild anzeigen', en: 'Show fullscreen' },
  linkCopied: { de: 'Link wurde kopiert.', en: 'Link copied.' },
  imageCopied: { de: 'QR-Code wurde als PNG kopiert.', en: 'QR code copied as a PNG.' },
  clipboardError: {
    de: 'Kopieren wird von diesem Browser nicht unterstützt.',
    en: 'Copying is not supported by this browser.',
  },
  unrecognizedCheckIns: { de: 'Nicht erkannt', en: 'Not recognized' },
  unrecognizedWarning: { de: '{n} nicht erkannt', en: '{n} not recognized' },
  saveAsNewMember: { de: 'Als neues Mitglied speichern', en: 'Save as new member' },
  saveAsNewMemberHint: {
    de: 'Diese Person wird als neues Mitglied im Projekt gespeichert und dem Check-in zugeordnet.',
    en: 'This person will be saved as a new project member and assigned to the check-in.',
  },
  successfulCheckIns: { de: 'Erfolgreich eingecheckt', en: 'Successfully checked in' },
  noUnrecognizedCheckIns: { de: 'Keine nicht erkannten Check-ins', en: 'No unrecognized check-ins' },
  noSuccessfulCheckIns: { de: 'Noch keine erfolgreichen Check-ins', en: 'No successful check-ins yet' },
  assignCheckIn: { de: 'Check-in zuordnen', en: 'Assign check-in' },
  assignCheckInHint: {
    de: 'Wähle das Mitglied aus, das mit diesem Check-in gemeint ist.',
    en: 'Choose the member this check-in belongs to.',
  },
  noMatchingMembers: { de: 'Versuche es mit einer neuen Suche', en: 'Try a new search' },
  suggestedMembers: { de: 'Ähnliche Mitglieder', en: 'Similar members' },
  similarity: { de: 'Ähnlichkeit', en: 'similarity' },
  assignmentError: {
    de: 'Der Check-in konnte nicht zugeordnet werden.',
    en: 'The check-in could not be assigned.',
  },
  submittedAt: { de: 'Zeitpunkt', en: 'Submitted at' },
  checkInFormTitle: { de: 'Bei Probe einchecken', en: 'Check in to event' },
  selectGroup: { de: 'Gruppe auswählen', en: 'Select group' },
  submitCheckIn: { de: 'Einchecken', en: 'Check in' },
  checkInSuccess: {
    de: 'Dein Check-in wurde erfolgreich übermittelt.',
    en: 'Your check-in was submitted successfully.',
  },
  checkInUnavailable: {
    de: 'Dieser Check-in ist momentan nicht geöffnet.',
    en: 'This check-in is not open right now.',
  },
  checkInInvalid: {
    de: 'Dieser QR-Code ist nicht mehr gültig.',
    en: 'This QR code is no longer valid.',
  },
  checkInSubmitError: {
    de: 'Der Check-in konnte nicht übermittelt werden. Bitte versuche es erneut.',
    en: 'The check-in could not be submitted. Please try again.',
  },
  noGroupsAvailable: {
    de: 'Für dieses Projekt sind keine Gruppen verfügbar.',
    en: 'No groups are available for this project.',
  },
  checkInNotAllowed: {
    de: 'Diese Art von Check-in ist für dieses Projekt nicht erlaubt.',
    en: 'This kind of check-in is not allowed for this project.',
  },
  checkInAsGuestInstead: {
    de: 'Stattdessen als Gast einchecken',
    en: 'Check in as a guest instead',
  },
  checkInWithAccountInstead: {
    de: 'Stattdessen mit Konto einchecken',
    en: 'Check in with your account instead',
  },
  guestCheckInDisabled: {
    de: 'Der Check-in ohne Konto ist für dieses Projekt deaktiviert.',
    en: 'Checking in without an account is disabled for this project.',
  },
  signInToCheckIn: {
    de: 'Anmelden und mit Konto einchecken',
    en: 'Sign in to check in with your account',
  },
  accountCheckInJoinHint: {
    de: 'Du bist noch kein Mitglied dieses Projekts. Mit dem Check-in trittst du dem Projekt bei.',
    en: 'You are not part of this project yet. Checking in will add you to the project.',
  },

  // Participation (Meine Teilnahme)
  myParticipation: { de: 'Meine Teilnahme', en: 'My participation' },
  joinProject: { de: 'Projekt beitreten', en: 'Join project' },
  joinProjectHint: {
    de: 'Du nimmst an diesem Projekt noch nicht teil. Tritt bei, um in der Anwesenheit geführt zu werden.',
    en: 'You are not participating in this project yet. Join to be included in attendance.',
  },
  rejoinProjectHint: {
    de: 'Du hast dieses Projekt verlassen. Du kannst jederzeit wieder beitreten; deine bisherige Anwesenheit bleibt erhalten.',
    en: 'You left this project. You can rejoin at any time; your previous attendance is kept.',
  },
  leaveProject: { de: 'Projekt verlassen', en: 'Leave project' },
  leaveProjectHint: {
    de: 'Du wirst aus der aktiven Mitgliederliste entfernt. Deine bisherige Anwesenheit bleibt gespeichert.',
    en: 'You are removed from the active member list. Your attendance history is kept.',
  },
  confirmLeaveProject: {
    de: 'Dieses Projekt wirklich verlassen?',
    en: 'Really leave this project?',
  },
  myGroup: { de: 'Meine Gruppe', en: 'My group' },
  myGroupHint: {
    de: 'Deine Gruppe in diesem Projekt. Gruppen gelten pro Projekt.',
    en: 'Your group in this project. Groups are per project.',
  },
  upcomingEvents: { de: 'Kommende Proben', en: 'Upcoming events' },
  noUpcomingEvents: { de: 'Keine kommenden Proben', en: 'No upcoming events' },
  myAttendance: { de: 'Meine Anwesenheit', en: 'My attendance' },
  noAttendanceYet: { de: 'Noch keine Anwesenheit erfasst', en: 'No attendance recorded yet' },
  participationError: {
    de: 'Die Aktion konnte nicht ausgeführt werden. Bitte versuche es erneut.',
    en: 'The action could not be completed. Please try again.',
  },

  // Project access settings
  accessSettings: { de: 'Zugriff & Formulare', en: 'Access & forms' },
  generalSettings: { de: 'Allgemein', en: 'General' },
  participantsSettings: { de: 'Teilnehmende', en: 'Participants' },
  participantsSettingsHint: {
    de: 'Was Mitglieder mit Konto in diesem Projekt sehen.',
    en: 'What members with an account see in this project.',
  },
  checkinSettings: { de: 'Check-in', en: 'Check-in' },
  checkinSettingsHint: {
    de: 'Wie sich Teilnehmende bei Proben einchecken können.',
    en: 'How people can check in to rehearsals.',
  },
  signupSettings: { de: 'Anmeldung', en: 'Sign-up' },
  signupSettingsHint: {
    de: 'Wie sich Personen über Anmeldeformulare registrieren können.',
    en: 'How people can register through sign-up forms.',
  },
  deleteProject: { de: 'Projekt löschen', en: 'Delete project' },
  accessSettingsHint: {
    de: 'Lege fest, wie Konten und Gäste mit diesem Projekt interagieren dürfen.',
    en: 'Control how accounts and guests may interact with this project.',
  },
  allowAccountAccess: { de: 'Konto-Zugriff erlauben', en: 'Allow account access' },
  allowAccountAccessHint: {
    de: 'Teilnehmende können sich anmelden, das Projekt sehen und ihre eigene Anwesenheit einsehen.',
    en: 'Participants can log in, see the project and view their own attendance.',
  },
  allowAccountCheckin: { de: 'Konto-Check-in erlauben', en: 'Allow account check-in' },
  allowAccountCheckinHint: {
    de: 'Auf den Check-in-Formularen kann man sich anmelden und mit Konto einchecken.',
    en: 'Check-in forms offer signing in and checking in with an account.',
  },
  allowAccountSignup: { de: 'Konto-Anmeldung erlauben', en: 'Allow account sign-up' },
  allowAccountSignupHint: {
    de: 'Auf den Anmeldeformularen kann man sich mit Konto anmelden.',
    en: 'Registration forms offer signing up with an account.',
  },
  allowGuestCheckin: { de: 'Gast-Check-in erlauben', en: 'Allow guest check-in' },
  allowGuestCheckinHint: {
    de: 'Auf den Check-in-Formularen kann man ohne Konto einchecken.',
    en: 'Check-in forms work without logging in to an account.',
  },
  allowGuestSignup: { de: 'Gast-Anmeldung erlauben', en: 'Allow guest sign-up' },
  allowGuestSignupHint: {
    de: 'Auf den Anmeldeformularen kann man sich ohne Konto anmelden.',
    en: 'Registration forms work without logging in to an account.',
  },
  allowParticipantPieces: {
    de: 'Stücke für Teilnehmende anzeigen',
    en: 'Show pieces to participants',
  },
  allowParticipantPiecesHint: {
    de: 'Teilnehmende sehen die Stücke-Seite mit Noten, Audio und Übungsansicht.',
    en: 'Participants see the pieces page with scores, audio and the practice view.',
  },

  // Club (Verein) section with the association's member directory
  club: { de: 'Verein (Beta)', en: 'Club (beta)' },
  membershipApplications: { de: 'Mitgliedsanträge', en: 'Membership applications' },
  rules: { de: 'Regeln', en: 'Rules' },
  newClubMember: { de: 'Neues Vereinsmitglied', en: 'New club member' },
  editClubMember: { de: 'Vereinsmitglied bearbeiten', en: 'Edit club member' },
  noClubMembers: { de: 'Noch keine Vereinsmitglieder', en: 'No club members yet' },
  memberTitle: { de: 'Titel', en: 'Title' },
  salutation: { de: 'Anrede', en: 'Salutation' },
  careOf: { de: 'Zusatz / c/o', en: 'Care of (c/o)' },
  street: { de: 'Straße und Hausnummer', en: 'Street and number' },
  addressExtra: { de: 'Adresszusatz', en: 'Address addition' },
  addressExtraHint: {
    de: 'z. B. Gebäude, Stockwerk oder Wohnungsnummer',
    en: 'e.g. building, floor or apartment number',
  },
  postalCode: { de: 'Postleitzahl (PLZ)', en: 'Postal code' },
  city: { de: 'Ort / Stadt', en: 'City' },
  country: { de: 'Land', en: 'Country' },
  phone: { de: 'Telefonnummer', en: 'Phone number' },
  passive: { de: 'Passiv', en: 'Passive' },
  clubMemberSaved: { de: 'Gespeichert', en: 'Saved' },
  contactDetails: { de: 'Kontakt', en: 'Contact' },
  addressSection: { de: 'Adresse', en: 'Address' },
  masterData: { de: 'Stammdaten', en: 'Details' },

  // Pieces (Stücke)
  pieces: { de: 'Stücke', en: 'Pieces' },
  newPiece: { de: 'Neues Stück', en: 'New piece' },
  editPiece: { de: 'Stück bearbeiten', en: 'Edit piece' },
  pieceName: { de: 'Name des Stücks', en: 'Piece name' },
  composer: { de: 'Komponist', en: 'Composer' },
  noPieces: { de: 'Noch keine Stücke', en: 'No pieces yet' },
  confirmDeletePiece: {
    de: 'Dieses Stück mitsamt allen Inhalten endgültig löschen? Dies kann nicht rückgängig gemacht werden.',
    en: 'Permanently delete this piece and all of its content? This cannot be undone.',
  },
  addBlock: { de: 'Block hinzufügen', en: 'Add block' },
  editBlock: { de: 'Block bearbeiten', en: 'Edit block' },
  blockFile: { de: 'Datei', en: 'File' },
  blockAudio: { de: 'Audio', en: 'Audio' },
  blockLink: { de: 'Link', en: 'Link' },
  blockText: { de: 'Text', en: 'Text' },
  noBlocks: {
    de: 'Noch keine Inhalte. Füge Dateien, Audio, Links oder Texte hinzu.',
    en: 'No content yet. Add files, audio, links or text.',
  },
  file: { de: 'Datei', en: 'File' },
  audioFile: { de: 'Audiodatei', en: 'Audio file' },
  selectFile: { de: 'Datei auswählen…', en: 'Select file…' },
  replaceFileHint: {
    de: 'Eine neue Datei ersetzt die bisherige.',
    en: 'A new file replaces the current one.',
  },
  displayName: { de: 'Anzeigename', en: 'Display name' },
  linkUrl: { de: 'URL', en: 'URL' },
  uploadError: {
    de: 'Die Datei konnte nicht hochgeladen werden.',
    en: 'The file could not be uploaded.',
  },
  invalidUrl: {
    de: 'Bitte gib eine gültige http(s)-URL an.',
    en: 'Please enter a valid http(s) URL.',
  },
  hasBars: { de: 'Diese Tondatei hat Takte', en: 'This audio file has bars' },
  hasBarsHint: {
    de: 'Ermöglicht das Abspielen ab einem bestimmten Takt auf einer eigenen Übungsseite.',
    en: 'Enables starting playback at a specific bar on a dedicated practice page.',
  },
  barsCount: { de: 'Anzahl der Takte', en: 'Number of bars' },
  barsStartAt: { de: 'Beginnt bei Takt', en: 'Starts at bar' },
  barsEndAt: { de: 'Endet bei Takt', en: 'Ends at bar' },
  bar: { de: 'Takt', en: 'Bar' },
  selection: { de: 'Auswahl', en: 'Selection' },
  clearSelection: { de: 'Auswahl aufheben', en: 'Clear selection' },
  loop: { de: 'Wiederholen', en: 'Loop' },
  playbackSpeed: { de: 'Geschwindigkeit', en: 'Playback speed' },
  barGridHint: {
    de: 'Tippe auf einen Takt, um dort zu starten. Shift-Klick wählt einen Bereich aus.',
    en: 'Tap a bar to start playback there. Shift-click selects a range.',
  },
  addScorePdf: { de: 'Noten-PDF hinzufügen', en: 'Add score PDF' },
  replaceScorePdf: { de: 'PDF ersetzen', en: 'Replace PDF' },
  removeScorePdf: { de: 'PDF entfernen', en: 'Remove PDF' },
  anchorBars: { de: 'Takte verankern', en: 'Anchor bars' },
  done: { de: 'Fertig', en: 'Done' },
  placeAnchorHint: {
    de: 'Klicke im PDF an die Stelle für Takt {n}.',
    en: 'Click the spot in the PDF for bar {n}.',
  },
  allBarsAnchored: {
    de: 'Alle Takte sind verankert.',
    en: 'All bars are anchored.',
  },
  anchorEditHint: {
    de: 'Ziehen verschiebt eine Verankerung, Klick entfernt sie. Im Raster wählst du den nächsten Takt.',
    en: 'Drag moves an anchor, click removes it. Use the grid to choose the next bar.',
  },
  anchorSaveError: {
    de: 'Die Verankerungen konnten nicht gespeichert werden',
    en: 'The anchors could not be saved',
  },
  pdfLoadError: {
    de: 'Das PDF konnte nicht geladen werden.',
    en: 'The PDF could not be loaded.',
  },
  confirmRemoveScore: {
    de: 'Das Noten-PDF und alle Takt-Verankerungen werden entfernt. Fortfahren?',
    en: 'The score PDF and all bar anchors will be removed. Continue?',
  },

  // Registration pages
  registration: { de: 'Anmeldungen', en: 'Registrations' },
  registrationPages: { de: 'Anmeldungen', en: 'Registrations' },
  newRegistrationPage: { de: 'Neue Quelle', en: 'New source' },
  registrationSource: { de: 'Art', en: 'Type' },
  sourceForm: { de: 'Formular', en: 'Form' },
  sourceFormHint: {
    de: 'Öffentliches Anmeldeformular mit Link und QR-Code.',
    en: 'Public registration form with a link and QR code.',
  },
  sourceWebhook: { de: 'Webhook', en: 'Webhook' },
  sourceWebhookHint: {
    de: 'Anmeldungen kommen aus einem anderen Dienst, z. B. Google Forms, Microsoft Forms, Zapier oder IFTTT.',
    en: 'Registrations arrive from another service, e.g. Google Forms, Microsoft Forms, Zapier or IFTTT.',
  },
  webhookUrl: { de: 'Webhook-URL', en: 'Webhook URL' },
  webhookUrlHint: {
    de: 'Sende jede Anmeldung als POST-Anfrage an diese URL (JSON oder Formulardaten). Behandle die URL wie ein Passwort.',
    en: 'Send each registration as a POST request to this URL (JSON or form data). Treat the URL like a password.',
  },
  regenerateUrl: { de: 'Neue URL erzeugen', en: 'Generate new URL' },
  confirmRegenerateUrl: {
    de: 'Die bisherige URL funktioniert danach nicht mehr. Alle Integrationen müssen die neue URL verwenden.',
    en: 'The current URL stops working. All integrations must switch to the new URL.',
  },
  webhookLastDelivery: { de: 'Letzte Übermittlung', en: 'Last delivery' },
  webhookNoDelivery: {
    de: 'Noch nichts empfangen. Sende eine Testanmeldung, um die Felder zu sehen.',
    en: 'Nothing received yet. Send a test registration to see its fields.',
  },
  webhookStatus_ok: { de: 'Angenommen', en: 'Accepted' },
  webhookStatus_missing_name: { de: 'Abgelehnt: kein Name erkannt', en: 'Rejected: no name found' },
  webhookStatus_invalid_input: { de: 'Abgelehnt: Werte zu lang', en: 'Rejected: values too long' },
  webhookStatus_inactive: { de: 'Abgelehnt: Anmeldung inaktiv', en: 'Rejected: registration inactive' },
  webhookMappingVisualHint: {
    de: 'Rechts siehst du, wofür jedes Feld verwendet wird. „Auto“ ist automatisch erkannt – wähle etwas anderes, um es festzulegen.',
    en: 'On the right you see what each field is used for. "Auto" is detected automatically – choose something else to fix it.',
  },
  webhookSwitchedOff: { de: 'Ausgeschaltet', en: 'Switched off' },
  remapUpdated: {
    de: 'Zuordnung gespeichert – {n} offene Anmeldungen aktualisiert',
    en: 'Mapping saved – {n} pending registrations updated',
  },
  remapSkipped: {
    de: '{n} unverändert, weil damit kein Name erkannt würde',
    en: '{n} unchanged because no name would be found',
  },
  remapWithoutRaw: {
    de: '{n} ohne Rohdaten (älter oder von Hand bearbeitet)',
    en: '{n} without raw data (older or edited by hand)',
  },
  webhookResetMapping: { de: 'Automatische Erkennung wiederherstellen', en: 'Restore automatic detection' },
  fullNameField: { de: 'Vollständiger Name', en: 'Full name' },
  webhookSetup: { de: 'Einrichtung', en: 'Setup' },
  webhookAutoTransferNote: {
    de: 'Anmeldungen mit einer Gruppe, die es im Projekt nicht gibt, werden nicht automatisch übertragen.',
    en: "Registrations with a group the project doesn't have are never transferred automatically.",
  },
  unknownGroupHint: {
    de: 'Gibt es im Projekt nicht',
    en: "Not in the project",
  },
  createThisGroup: { de: 'Gruppe anlegen', en: 'Create group' },
  unknownGroupsBlocked: {
    de: '{n} Anmeldungen haben eine Gruppe, die es im Projekt nicht gibt. Sie können erst übertragen werden, wenn du die Gruppe korrigierst oder anlegst.',
    en: "{n} registrations have a group the project doesn't have. They can only be transferred once you correct or create the group.",
  },
  unknownGroupBlocksTransfer: {
    de: 'Erst Gruppe korrigieren oder anlegen',
    en: 'Correct or create the group first',
  },
  editRegistrationPage: { de: 'Quelle bearbeiten', en: 'Edit source' },
  noRegistrationPages: { de: 'Noch keine Quellen', en: 'No sources yet' },
  registrationTitle: { de: 'Titel', en: 'Title' },
  registrationDescription: { de: 'Beschreibung', en: 'Description' },
  registrationDescriptionHint: {
    de: 'Markdown wird unterstützt (Überschriften, Listen, **fett**, Links).',
    en: 'Markdown is supported (headings, lists, **bold**, links).',
  },
  askEmail: { de: 'E-Mail erfragen', en: 'Ask for email' },
  askGroup: { de: 'Gruppe erfragen', en: 'Ask for group' },
  askGroupProjectHint: {
    de: 'Die auswählbaren Gruppen werden in den Projekteinstellungen festgelegt.',
    en: 'The selectable groups are defined in the project settings.',
  },
  groupsList: { de: 'Gruppen', en: 'Groups' },
  groupsHint: {
    de: 'Die Reihenfolge hier gilt überall: Check-in, Anmeldung, Teilnahme und Auswahllisten. Zum Umsortieren ziehen.',
    en: 'The order here is used everywhere: check-in, sign-up, participation and dropdowns. Drag to reorder.',
  },
  newGroup: { de: 'Neue Gruppe', en: 'New group' },
  editGroup: { de: 'Gruppe bearbeiten', en: 'Edit group' },
  groupName: { de: 'Gruppenname', en: 'Group name' },
  groupColor: { de: 'Farbe', en: 'Color' },
  customColor: { de: 'Eigene Farbe', en: 'Custom color' },
  groupMemberCount: { de: 'Mitglieder', en: 'Members' },
  noGroups: { de: 'Noch keine Gruppen', en: 'No groups yet' },
  groupDistribution: { de: 'Verteilung', en: 'Distribution' },
  registrationGroupDistributionHint: {
    de: 'Anmeldungen je Gruppe – klicke auf eine Gruppe, um die Liste zu filtern.',
    en: 'Registrations per group – click a group to filter the list.',
  },
  alreadyMember: { de: 'Bereits Mitglied', en: 'Already a member' },
  alreadyMemberArchived: { de: 'Archiviertes Mitglied', en: 'Archived member' },
  alreadyMemberHint: {
    de: 'Passt zu {name} – beim Übernehmen wird dieses Mitglied aktualisiert statt neu angelegt.',
    en: 'Matches {name} – transferring updates this member instead of creating a new one.',
  },
  unknownGroupsSlice: { de: 'Nicht im Projekt', en: 'Not in the project' },
  showAllGroups: { de: 'Alle Gruppen anzeigen', en: 'Show all groups' },
  groupDistributionHint: {
    de: 'Aktive Mitglieder je Gruppe',
    en: 'Active members per group',
  },
  groupDonutTotal: { de: 'Mitglieder', en: 'Members' },
  noGroupAssigned: { de: 'Ohne Gruppe', en: 'No group' },
  noMembersInGroup: { de: 'Keine Mitglieder in dieser Gruppe', en: 'No members in this group' },
  groupNameTaken: {
    de: 'Eine Gruppe mit diesem Namen gibt es bereits.',
    en: 'A group with this name already exists.',
  },
  groupRenameHint: {
    de: 'Umbenennen wird bei allen Mitgliedern übernommen.',
    en: 'Renaming applies to all members.',
  },
  confirmDeleteGroup: {
    de: 'Die Gruppe wird gelöscht. {n} Mitglieder haben danach keine Gruppe mehr.',
    en: 'The group will be deleted. {n} members will no longer have a group.',
  },
  activate: { de: 'Aktivieren', en: 'Activate' },
  deactivate: { de: 'Deaktivieren', en: 'Deactivate' },
  registrationActive: { de: 'Anmeldung ist aktiv', en: 'Registration is active' },
  registrationInactiveStatus: { de: 'Anmeldung ist deaktiviert', en: 'Registration is inactive' },
  registrationLinkHint: {
    de: 'Teile diesen Link, um das öffentliche Anmeldeformular zu öffnen.',
    en: 'Share this link to open the public registration form.',
  },
  registrations: { de: 'Anmeldungen', en: 'Registrations' },
  noRegistrations: { de: 'Noch keine Anmeldungen', en: 'No registrations yet' },
  transferToMembers: { de: 'Zu Mitgliedern übertragen', en: 'Transfer to members' },
  transferAllToMembers: { de: 'Alle übertragen', en: 'Transfer all' },
  transferSelection: { de: 'Auswahl übertragen', en: 'Transfer a selection' },
  selectionFirst: { de: 'Die ersten', en: 'The first' },
  selectionFirstHint: {
    de: 'Nach Anmeldezeitpunkt, früheste zuerst.',
    en: 'By registration time, earliest first.',
  },
  selectionRandom: { de: 'Zufällig auslosen', en: 'Random draw' },
  selectionRandomHint: {
    de: 'Gleichmäßig zufällig aus allen offenen Anmeldungen, gelost auf dem Server.',
    en: 'Uniformly at random from all pending registrations, drawn on the server.',
  },
  selectionCount: { de: 'Anzahl', en: 'Number' },
  selectionOfPending: { de: 'von {n} offenen Anmeldungen', en: 'of {n} pending registrations' },
  selectionSubmit: { de: '{n} übertragen', en: 'Transfer {n}' },
  selectionDrawSubmit: { de: '{n} auslosen und übertragen', en: 'Draw and transfer {n}' },
  selectionPreview: { de: 'Diese Anmeldungen werden übertragen', en: 'These registrations will be transferred' },
  selectionResult: { de: '{n} übertragen', en: '{n} transferred' },
  selectionDrawResult: { de: 'Ausgelost und übertragen: {n}', en: 'Drawn and transferred: {n}' },
  selectionAndMore: { de: 'und {n} weitere', en: 'and {n} more' },
  selectedCount: { de: '{n} ausgewählt', en: '{n} selected' },
  confirmBulkDeleteRegistrations: {
    de: 'Ausgewählte Anmeldungen endgültig löschen? Dies kann nicht rückgängig gemacht werden.',
    en: 'Permanently delete the selected registrations? This cannot be undone.',
  },
  transferred: { de: 'Übertragen', en: 'Transferred' },
  notTransferred: { de: 'Offen', en: 'Pending' },
  autoTransfer: { de: 'Automatisch übertragen', en: 'Auto-transfer' },
  autoTransferHint: {
    de: 'Neue Anmeldungen werden automatisch in die Mitgliederliste übertragen.',
    en: 'New registrations are automatically added to the members list.',
  },
  registeredAt: { de: 'Angemeldet', en: 'Registered' },

  // Public registration flow
  next: { de: 'Weiter', en: 'Next' },
  enterYourData: { de: 'Deine Daten', en: 'Your details' },
  reviewYourData: { de: 'Angaben überprüfen', en: 'Review your details' },
  reviewHint: {
    de: 'Bitte überprüfe deine Angaben, bevor du die Anmeldung abschickst.',
    en: 'Please review your details before submitting the registration.',
  },
  privacyNotice: {
    de: 'Mit dem Absenden willigst du ein, dass die angegebenen Daten zum Zweck der Verwaltung deiner Anmeldung gespeichert und verarbeitet werden. Die Daten werden nicht an Dritte weitergegeben.',
    en: 'By submitting you consent to your data being stored and processed for the purpose of managing your registration. The data will not be shared with third parties.',
  },
  acceptPrivacy: {
    de: 'Ich habe den Datenschutzhinweis gelesen und stimme zu.',
    en: 'I have read and accept the privacy notice.',
  },
  submitRegistration: { de: 'Anmeldung abschicken', en: 'Submit registration' },
  registrationSuccess: {
    de: 'Deine Anmeldung wurde erfolgreich übermittelt.',
    en: 'Your registration was submitted successfully.',
  },
  registrationSubmitError: {
    de: 'Die Anmeldung konnte nicht übermittelt werden. Bitte versuche es erneut.',
    en: 'The registration could not be submitted. Please try again.',
  },
  registrationUnavailable: {
    de: 'Diese Anmeldung ist momentan nicht geöffnet.',
    en: 'This registration is not open right now.',
  },
  registrationInvalid: {
    de: 'Dieser Anmeldelink ist nicht mehr gültig.',
    en: 'This registration link is no longer valid.',
  },
  startRegistration: { de: 'Anmeldung starten', en: 'Start registration' },
  registrationNotAllowed: {
    de: 'Diese Art der Anmeldung ist für dieses Projekt nicht erlaubt.',
    en: 'This kind of registration is not allowed for this project.',
  },
  guestSignupDisabled: {
    de: 'Die Anmeldung ohne Konto ist für dieses Projekt deaktiviert.',
    en: 'Registering without an account is disabled for this project.',
  },
  signInToRegister: {
    de: 'Anmelden und mit Konto registrieren',
    en: 'Sign in to register with your account',
  },
  registeringWithAccount: {
    de: 'Du meldest dich mit deinem Konto an.',
    en: 'You are registering with your account.',
  },
  continueAsGuestInstead: {
    de: 'Stattdessen als Gast fortfahren',
    en: 'Continue as a guest instead',
  },
  continueWithAccountInstead: {
    de: 'Stattdessen mit Konto fortfahren',
    en: 'Continue with your account instead',
  },
  dataFromAccountHint: {
    de: 'Name und E-Mail werden aus deinem Konto übernommen. Nur die Gruppe wählst du pro Projekt.',
    en: 'Name and email are taken from your account. Only the group is chosen per project.',
  },

  // Project onboarding
  onboardingStepProject: { de: 'Projekt', en: 'Project' },
  onboardingStepMembers: { de: 'Mitglieder', en: 'Members' },
  onboardingStepGroups: { de: 'Gruppen', en: 'Groups' },
  onboardingStepDone: { de: 'Fertig', en: 'Done' },
  onboardingSkip: { de: 'Einrichtung überspringen', en: 'Skip setup' },
  onboardingContinue: { de: 'Weiter', en: 'Continue' },
  onboardingProjectTitle: { de: 'Neues Projekt anlegen', en: 'Create a new project' },
  onboardingProjectHint: {
    de: 'Gib deinem Projekt einen Namen und ein Logo. Beides kannst du später jederzeit ändern.',
    en: 'Give your project a name and a logo. You can change both at any time later.',
  },
  onboardingLogo: { de: 'Logo', en: 'Logo' },
  onboardingLogoHint: { de: 'Quadratisches Bild, z. B. PNG oder JPG', en: 'Square image, e.g. PNG or JPG' },
  onboardingLogoUpload: { de: 'Logo hochladen', en: 'Upload logo' },
  onboardingNamePlaceholder: { de: 'z. B. Sommerkonzert 2026', en: 'e.g. Summer concert 2026' },
  onboardingMembersTitle: { de: 'Mitgliederliste importieren', en: 'Import your member list' },
  onboardingMembersHint: {
    de: 'Lade eine CSV-Datei hoch, z. B. einen Export aus Excel oder Google Sheets. Gruppen aus der Datei werden automatisch angelegt.',
    en: 'Upload a CSV file, e.g. an export from Excel or Google Sheets. Groups found in the file are created automatically.',
  },
  onboardingDropCsv: { de: 'CSV-Datei hierher ziehen', en: 'Drop a CSV file here' },
  onboardingDropCsvHint: { de: 'oder klicken, um eine Datei auszuwählen', en: 'or click to choose a file' },
  onboardingImportAndContinue: { de: 'Importieren & weiter', en: 'Import & continue' },
  onboardingContinueWithoutImport: { de: 'Ohne Import weiter', en: 'Continue without import' },
  onboardingImported: {
    de: '{n} Mitglieder werden mit dem Projekt angelegt. Ein erneuter Import ersetzt sie.',
    en: '{n} members will be created with the project. Importing again replaces them.',
  },
  onboardingDiscardTitle: { de: 'Einrichtung verwerfen?', en: 'Discard setup?' },
  onboardingDiscardMessage: {
    de: 'Das Projekt wurde noch nicht angelegt. Alle Eingaben gehen verloren.',
    en: 'The project has not been created yet. Everything you entered will be lost.',
  },
  onboardingDiscard: { de: 'Verwerfen', en: 'Discard' },
  onboardingGroupsTitle: { de: 'Gruppen prüfen', en: 'Review your groups' },
  onboardingGroupsHint: {
    de: 'Lege Gruppen an, benenne sie um, wähle Farben und bring sie per Drag & Drop in die richtige Reihenfolge. Diese Reihenfolge gilt überall im Projekt.',
    en: 'Create groups, rename them, pick colors and drag them into the right order. This order is used everywhere in the project.',
  },
  onboardingNoGroups: {
    de: 'Noch keine Gruppen. Lege z. B. Stimmen oder Register an.',
    en: 'No groups yet. Add e.g. voices or sections.',
  },
  onboardingMembersCount: { de: '{n} Mitglieder', en: '{n} members' },
  onboardingSetUpProject: { de: 'Projekt einrichten', en: 'Set up project' },
  onboardingDoneTitle: { de: '{name} ist startklar', en: '{name} is ready' },
  onboardingDoneHint: {
    de: 'Dein Projekt ist eingerichtet. Hier sind ein paar Ideen, wie es weitergeht.',
    en: 'Your project is set up. Here are a few ideas for what to do next.',
  },
  onboardingOpenProject: { de: 'Zum Projekt', en: 'Open project' },
  onboardingTipEvent: { de: 'Neue Probe hinzufügen', en: 'Add a rehearsal' },
  onboardingTipEventHint: {
    de: 'Plane Proben und erfasse die Anwesenheit per Check-in.',
    en: 'Schedule rehearsals and track attendance with check-in.',
  },
  onboardingTipPieces: { de: 'Stücke und MIDIs hochladen', en: 'Upload pieces and MIDIs' },
  onboardingTipPiecesHint: {
    de: 'Stelle Noten und Übe-Dateien für alle Stimmen bereit.',
    en: 'Share scores and practice files for every section.',
  },
  onboardingTipRegistration: { de: 'Anmeldeformular erstellen', en: 'Create a sign-up form' },
  onboardingTipRegistrationHint: {
    de: 'Oder verknüpfe Google Forms bzw. einen Webhook, um Anmeldungen zu sammeln.',
    en: 'Or connect Google Forms or a webhook to collect sign-ups.',
  },
  onboardingTipPermissions: { de: 'Berechtigungen bearbeiten', en: 'Edit permissions' },
  onboardingTipPermissionsHint: {
    de: 'Lege fest, was Teilnehmende und Gäste sehen und tun dürfen.',
    en: 'Decide what participants and guests can see and do.',
  },
  onboardingTipAbsences: { de: 'Regel für Fehlzeiten hinzufügen', en: 'Add an absence rule' },
  onboardingTipAbsencesHint: {
    de: 'Finde automatisch, wer zu oft gefehlt hat.',
    en: 'Automatically find who has missed too many rehearsals.',
  },

  // Confirmations
  confirmDelete: {
    de: 'Wirklich endgültig löschen? Dies kann nicht rückgängig gemacht werden.',
    en: 'Permanently delete? This cannot be undone.',
  },
};


export type TranslationKey = keyof typeof dict;
interface I18nContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'anwesenheit.lang';

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Language>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
    return stored ?? DEFAULT_LANGUAGE;
  });

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang: (l: Language) => {
        setLangState(l);
        localStorage.setItem(STORAGE_KEY, l);
      },
      t: (key) => dict[key]?.[lang] ?? String(key),
    }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
};
