// Step-by-step setup guides for sending registrations to a webhook page.
// Kept as data (not i18n keys) because they are long, structured and carry
// code snippets. `text` in backticks is rendered as inline code.
import type { Language } from '@/lib/config';

type Localized = Record<Language, string>;

export interface WebhookGuide {
  id: string;
  label: string;
  steps: Record<Language, string[]>;
  note?: Localized;
  code?: (url: string) => string;
}

const exampleJson = (url: string) => `curl -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -d '{"first_name": "Anna", "last_name": "Müller", "email": "anna@example.com", "group": "Sopran"}'`;

export const WEBHOOK_GUIDES: WebhookGuide[] = [
  {
    id: 'google',
    label: 'Google Forms',
    steps: {
      de: [
        'Öffne das Formular im Bearbeitungsmodus, dann ⋮ (Mehr) → „Apps Script“.',
        'Ersetze den vorhandenen Code durch das Skript unten und speichere.',
        'Links „Trigger“ (Wecker-Symbol) → „Trigger hinzufügen“: Funktion `onFormSubmit`, Ereignisquelle „Aus Formular“, Ereignistyp „Beim Senden des Formulars“. Speichern und den Zugriff erlauben.',
        'Sende eine Testantwort ab und prüfe unten „Letzte Übermittlung“.',
      ],
      en: [
        'Open the form in edit mode, then ⋮ (More) → "Apps Script".',
        'Replace the existing code with the script below and save.',
        'On the left, "Triggers" (alarm clock icon) → "Add trigger": function `onFormSubmit`, event source "From form", event type "On form submit". Save and grant access.',
        'Submit a test response and check "Last delivery" below.',
      ],
    },
    note: {
      de: 'Fragen mit Titeln wie „Vorname“, „Nachname“, „E-Mail“ und „Gruppe“ werden automatisch erkannt. Sammelt das Formular E-Mail-Adressen, wird diese mitgesendet.',
      en: 'Questions titled like "First name", "Last name", "Email" and "Group" are detected automatically. If the form collects email addresses, that address is sent too.',
    },
    code: (url) => `const WEBHOOK_URL = '${url}';

function onFormSubmit(e) {
  const data = {};
  e.response.getItemResponses().forEach(function (item) {
    data[item.getItem().getTitle()] = item.getResponse();
  });
  const email = e.response.getRespondentEmail();
  if (email) data['E-Mail'] = email;
  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(data),
    muteHttpExceptions: true,
  });
}`,
  },
  {
    id: 'microsoft',
    label: 'Microsoft Forms',
    steps: {
      de: [
        'In Power Automate „Erstellen“ → „Automatisierter Cloudflow“ mit dem Trigger „Wenn eine neue Antwort übermittelt wird“ (Microsoft Forms) und dein Formular auswählen.',
        'Aktion „Antwortdetails abrufen“ hinzufügen: gleiches Formular, Antwort-ID aus dem Trigger.',
        'Aktion „HTTP“ hinzufügen: Methode `POST`, URI = Webhook-URL, Header `Content-Type: application/json`, Text z. B. `{"Vorname": …, "Nachname": …, "E-Mail": …, "Gruppe": …}` mit den dynamischen Inhalten der Antwort.',
        'Flow speichern und eine Testantwort absenden.',
      ],
      en: [
        'In Power Automate, "Create" → "Automated cloud flow" with the trigger "When a new response is submitted" (Microsoft Forms) and pick your form.',
        'Add the action "Get response details": same form, response ID from the trigger.',
        'Add the action "HTTP": method `POST`, URI = webhook URL, header `Content-Type: application/json`, body e.g. `{"first_name": …, "last_name": …, "email": …, "group": …}` using the response\'s dynamic content.',
        'Save the flow and submit a test response.',
      ],
    },
    note: {
      de: 'Die HTTP-Aktion ist in Power Automate ein Premium-Connector. Ohne Premium lässt sich Microsoft Forms auch über Zapier oder Make anbinden.',
      en: 'The HTTP action is a premium connector in Power Automate. Without premium, Microsoft Forms can also be connected through Zapier or Make.',
    },
  },
  {
    id: 'zapier',
    label: 'Zapier',
    steps: {
      de: [
        'Neuen Zap erstellen. Trigger: deine Formular-App (z. B. Google Forms, Microsoft Forms, Typeform, Jotform) mit „New Response“.',
        'Aktion: „Webhooks by Zapier“ → Event `POST`.',
        'URL = Webhook-URL, Payload Type `json`. Unter „Data“ die Felder `first_name`, `last_name`, `email` und `group` anlegen und jeweils die Antwort aus dem Trigger zuordnen.',
        'Aktion testen und den Zap veröffentlichen.',
      ],
      en: [
        'Create a new Zap. Trigger: your form app (e.g. Google Forms, Microsoft Forms, Typeform, Jotform) with "New Response".',
        'Action: "Webhooks by Zapier" → event `POST`.',
        'URL = webhook URL, payload type `json`. Under "Data" add the fields `first_name`, `last_name`, `email` and `group` and map each to the trigger\'s answer.',
        'Test the action and publish the Zap.',
      ],
    },
    note: {
      de: '„Webhooks by Zapier“ ist je nach Zapier-Tarif nur in bezahlten Plänen verfügbar.',
      en: '"Webhooks by Zapier" may only be available on paid Zapier plans.',
    },
  },
  {
    id: 'ifttt',
    label: 'IFTTT',
    steps: {
      de: [
        'Neues Applet erstellen. „If This“: der Auslöser, z. B. Google Sheets „New row added to spreadsheet“ für die Antworttabelle eines Google-Formulars.',
        '„Then That“: „Webhooks“ → „Make a web request“.',
        'URL = Webhook-URL, Method `POST`, Content Type `application/json`, Body z. B. `{"first_name": "{{…}}", "last_name": "{{…}}", "email": "{{…}}", "group": "{{…}}"}` mit den Zutaten (Ingredients) des Auslösers.',
        'Applet speichern und eine Testanmeldung auslösen.',
      ],
      en: [
        'Create a new applet. "If This": the trigger, e.g. Google Sheets "New row added to spreadsheet" for a Google Form\'s response sheet.',
        '"Then That": "Webhooks" → "Make a web request".',
        'URL = webhook URL, method `POST`, content type `application/json`, body e.g. `{"first_name": "{{…}}", "last_name": "{{…}}", "email": "{{…}}", "group": "{{…}}"}` using the trigger\'s ingredients.',
        'Save the applet and trigger a test registration.',
      ],
    },
    note: {
      de: 'Webhooks sind bei IFTTT je nach Tarif nur mit IFTTT Pro nutzbar.',
      en: 'Depending on the plan, webhooks on IFTTT may require IFTTT Pro.',
    },
  },
  {
    id: 'make',
    label: 'Make',
    steps: {
      de: [
        'Neues Szenario erstellen. Erstes Modul: deine Formular-App (z. B. Google Forms, Microsoft Forms, Typeform) mit „Watch Responses“.',
        'Modul „HTTP“ → „Make a request“ anhängen: URL = Webhook-URL, Method `POST`, Body type `Raw`, Content type `JSON (application/json)`.',
        'Als Request content z. B. `{"first_name": …, "last_name": …, "email": …, "group": …}` mit den Werten aus dem ersten Modul eintragen.',
        'Szenario einmal ausführen, prüfen und aktivieren.',
      ],
      en: [
        'Create a new scenario. First module: your form app (e.g. Google Forms, Microsoft Forms, Typeform) with "Watch Responses".',
        'Add the module "HTTP" → "Make a request": URL = webhook URL, method `POST`, body type `Raw`, content type `JSON (application/json)`.',
        'As request content enter e.g. `{"first_name": …, "last_name": …, "email": …, "group": …}` with the values from the first module.',
        'Run the scenario once, check it and switch it on.',
      ],
    },
  },
  {
    id: 'other',
    label: 'Andere / Other',
    steps: {
      de: [
        'Jeder Dienst, der HTTP-Anfragen senden kann, funktioniert: eine `POST`-Anfrage pro Anmeldung an die Webhook-URL.',
        'Formate: JSON (auch verschachtelt, oder Listen wie `[{"title": "Vorname", "answer": "Anna"}]`), `application/x-www-form-urlencoded` oder `multipart/form-data`.',
        'Erkannte Felder: Vorname/Nachname (`first_name`, `last_name`, „Vorname“, „Nachname“ …) oder ein ganzer Name (`name`), E-Mail (`email`, „E-Mail“) und Gruppe (`group`, „Gruppe“, „Stimme“, „Instrument“ …).',
        'Antworten: `200 {"ok": true}` bei Erfolg, `422` wenn kein Name erkannt wurde, `409` wenn die Anmeldung inaktiv ist, `404` bei unbekannter URL.',
      ],
      en: [
        'Any service that can send HTTP requests works: one `POST` request per registration to the webhook URL.',
        'Formats: JSON (nested too, or lists like `[{"title": "First name", "answer": "Anna"}]`), `application/x-www-form-urlencoded` or `multipart/form-data`.',
        'Detected fields: first/last name (`first_name`, `last_name`, "First name", "Surname" …) or a full name (`name`), email (`email`, "E-mail") and group (`group`, "Voice", "Section", "Instrument" …).',
        'Responses: `200 {"ok": true}` on success, `422` when no name was found, `409` when the registration is inactive, `404` for an unknown URL.',
      ],
    },
    code: exampleJson,
  },
];
