# Implementierungs-Prompt: neue Projektbereiche

Erweitere das bestehende Projekt, ohne eine separate Mini-App oder große Neben-Refactorings zu bauen. Übernimm Design, Komponenten, mobile Darstellung, Rollenmodell und die Sprachen Deutsch, Englisch und Finnisch. „Projektverantwortliche“ meint im Folgenden Accounts, die ein Projekt nach dem bestehenden serverseitigen Rollenmodell verwalten dürfen; es entsteht keine neue Rolle. Teilnehmer sehen nur ausdrücklich freigegebene Inhalte und dürfen nur ihre eigenen Eingaben verändern. Ausnahmen wie Gast-Umfragen werden jeweils ausdrücklich beschrieben.

Verwende überall dieselben Lebenszyklen und Begriffe: Entwurf, Vorschau, veröffentlichen, Veröffentlichung zurücknehmen, schließen sowie manuell archivieren und wiederherstellen. Ein Datum darf Inhalte als vergangen einordnen oder schließen, aber niemals automatisch archivieren.

## Zuständige Personen in Gruppen

Es gibt keine eigene Verantwortlichen-Seite. Erweitere stattdessen die bestehende Gruppenverwaltung:

- Pro Gruppe können Projektverantwortliche mehrere zuständige Personen sowie eine interne Textnotiz pflegen.
- Die durchsuchbare Auswahl zeigt Name und Bild, priorisiert aktive Projektmitglieder und erlaubt auch vorhandene Accounts ohne bereits verknüpfte Mitgliedschaft. Zuständige müssen nicht derselben Gruppe angehören.
- Gruppenliste und Gruppendetail zeigen Projektverantwortlichen eine kompakte Vorschau.
- Teilnehmer dürfen Zuständige und Notiz weder in der UI noch über die API lesen.
- Eine Zuständigkeit ist nur organisatorisch und verleiht niemals Berechtigungen.

## Neues einseitiges Projekt-Onboarding

Ersetze das bisherige mehrstufige Projekt-Onboarding durch eine einzige lange, kompakte und ruhig gestaltete Seite. Alles bleibt auf derselben Route und wird von oben nach unten gescrollt; es gibt keine einzelnen Wizard-Seiten, kein Weiter/Zurück zwischen Schritten und keine aufwendigen Animationen. Die Seite soll sich eher wie ein gut strukturiertes Einrichtungsblatt anfühlen: klare nummerierte Abschnitte, wenig Leerraum, kurze Hilfetexte und kompakte wiederholbare Zeilen statt vieler großer Karten.

Dieses Onboarding gehört ausschließlich dem Account, der das neue Projekt erstellt. Es ist kein gemeinsamer Entwurf und kann weder von anderen privilegierten Personen gesehen noch parallel bearbeitet werden. Erst nachdem die erstellende Person den Vorgang erfolgreich abschließt, wird das Projekt für die nach dem normalen Rollensystem berechtigten Personen sichtbar. Ein gespeicherter Onboarding-Entwurf und seine hochgeladenen oder importierten Daten dürfen vorher nur für den Ersteller selbst zugänglich sein.

Eine schmale Sprungnavigation darf am Desktop am Rand oder oben kleben und direkt zu den Abschnitten führen. Auf dem Handy reicht eine kompakte Abschnittsübersicht. Sie ist nur eine Orientierung innerhalb derselben scrollbaren Seite und kein mehrstufiger Wizard. Ein ruhiger Status wie „Entwurf gespeichert“ und ein stets gut erreichbarer Button **Projekt erstellen** reichen; keine dekorativen Fortschrittsanimationen.

Nur der Projektname ist zwingend. Alle anderen Bereiche können leer bleiben und später eingerichtet werden. Optionale Bereiche bleiben zunächst kompakt und wachsen erst bei Benutzung. Ein privater, ausschließlich dem Ersteller zugänglicher Onboarding-Entwurf schützt die Eingaben auch nach Neuladen oder Gerätewechsel; er ist noch kein Projekt und wird nach erfolgreicher Erstellung oder „Entwurf verwerfen“ entfernt.

Die Abschnitte stehen genau in dieser Reihenfolge:

### 1. Projekt

Beginne mit Name, Beschreibung und Projektbild. Das Bild verwendet die vorhandene Upload- und Zuschneidefunktion. Daneben oder direkt darunter darf eine kleine, echte Vorschau zeigen, wie das Projekt später in Navigation und Projektliste wirkt.

### 2. Einstellungen

Zeige alle normalen, nicht destruktiven Einstellungen der bestehenden Projekteinstellungsseite mit identischen Bezeichnungen, Abhängigkeiten und Standardwerten: Accountzugriff, Check-in, Anmeldung, Gästezugriff, Sichtbarkeit der Stücke, Gruppenpflicht, Standardgruppe und Benachrichtigungen. Die Standardgruppe liest bereits die bearbeitete Gruppenliste aus dem folgenden Abschnitt. Archivieren und Löschen gehören nicht ins Onboarding.

### 3. Gruppen

Lege als bearbeitbare Vorauswahl diese acht Chorgruppen an:

- Sopran 1
- Sopran 2
- Alt 1
- Alt 2
- Tenor 1
- Tenor 2
- Bass 1
- Bass 2

Diese Vorauswahl wird angelegt, wenn der Ersteller sie unverändert überspringt. Alle Gruppen können umbenannt, entfernt, eingefärbt und sortiert werden; weitere lassen sich ergänzen. „Keine Gruppen anlegen“ entfernt die Vorauswahl vollständig, etwa für ein Orchesterprojekt.

Innerhalb jeder Gruppenzeile oder in einem kompakten aufklappbaren Detailbereich können optional bereits eine oder mehrere zuständige Personen und die interne Zuständigkeitsnotiz gesetzt werden. Weil zu diesem Zeitpunkt noch keine Mitglieder importiert sein müssen, kann hier nach bestehenden Accounts gesucht werden. Nach dem späteren Mitgliederimport sollen passende Verknüpfungen automatisch sichtbar werden. Die Eintragung gibt weiterhin keinerlei zusätzliche Rechte und bleibt für Teilnehmer unsichtbar.

### 4. Proben

Mehrere Proben können als kompakte, sortierbare Zeilen mit Titel, optionaler Beschreibung, Datum, Start-/Endzeit und Ort angelegt werden. Leere Zeilen werden ignoriert; sobald eine Zeile andere Angaben enthält, ist ihr Titel erforderlich. Verwende dieselben Regeln wie auf der bestehenden Probenseite.

### 5. Mitglieder

Bette den vorhandenen Mitgliederimport in kompakter Form ein. CSV-Datei und die bestehende Spaltenzuordnung, Vorschau, Gruppenabgleich, Dublettenerkennung und Accountverknüpfung sollen genauso verlässlich funktionieren wie beim späteren Import auf der Mitgliederseite. Noch nicht vorhandene Gruppen werden nicht unbemerkt erzeugt, sondern müssen einer vorhandenen Gruppe zugeordnet, bewusst ohne Gruppe importiert oder nach einer klaren Bestätigung ergänzt werden. Der gesamte Abschnitt kann leer bleiben.

### 6. Anmeldeformular

Optional kann direkt eine erste Anmeldequelle vom Typ Formular vorbereitet werden. Zeige dafür die wichtigsten vorhandenen Einstellungen kompakt eingebettet: Titel, Beschreibung, E-Mail- und Gruppenabfrage, Frist, Zusatzfeld, automatische Übernahme und Gestaltung. Das Formular startet nur dann aktiv, wenn dies ausdrücklich gewählt wurde; ansonsten wird es als vorbereiteter inaktiver Entwurf angelegt. Wer hier nichts einträgt, bekommt keine leere Anmeldequelle.

### 7. Konzerttermine

Mehrere Konzerte können mit Titel, Datum, Uhrzeit, Ort und Kurzbeschreibung vorbereitet werden. Leere Zeilen werden ignoriert; angefangene brauchen einen Titel. Sie starten unveröffentlicht. Dresscode, Programm und Aufnahmen folgen später auf der Konzertseite; ein vergangenes Datum archiviert nichts.

### 8. Stücke

Zeige zwei gleichwertige Wege in demselben kompakten Abschnitt:

- vorhandene Stücke aus der globalen Bibliothek suchen und auswählen,
- direkt ein neues leeres Stück mit mindestens Titel und optional Komponist anlegen.

Die ausgewählten und neuen Stücke erscheinen gemeinsam in einer sortierbaren Stückeliste. Doppelte Bibliotheksstücke werden verhindert. Ein neu angelegtes Stück wird regulär Teil der globalen Bibliothek und gleichzeitig diesem Projekt zugeordnet; dies muss im Text klar erkennbar sein. Noten, Aufnahmen und weitere Einrichtung können später auf der Stückseite folgen.

### 9. Vorsingregel

Optional kann direkt die Vorsingregel des Projekts festgelegt werden. Verwende denselben Bedingungseditor wie auf der Fehlzeitenseite und erkläre in einem kurzen Satz, wann ein Mitglied laut der gewählten Anwesenheitsbedingungen vorsingen muss. Ohne Bedingungen wird keine Vorsingregel angelegt. Die Regel kann später jederzeit in der bestehenden Verwaltung geändert werden.

### Abschluss des Onboardings

Am Ende steht eine kompakte Zusammenfassung mit den tatsächlich vorbereiteten Inhalten, beispielsweise „8 Gruppen · 12 Proben · 84 Mitglieder · 1 Anmeldeformular · 2 Konzerte · 9 Stücke“. Nicht eingerichtete Bereiche erscheinen höchstens als ruhiger Hinweis und nicht als Warnung. Fehler verlinken direkt zum betreffenden Abschnitt und bereits korrekte Bereiche bleiben erhalten.

Beim Klick auf **Projekt erstellen** werden Projekt und alle gewählten Untereinträge koordiniert angelegt. Ein Fehler darf kein halb eingerichtetes, für Teilnehmer sichtbares Projekt hinterlassen. Entweder wird die Einrichtung vollständig abgeschlossen oder der Entwurf bleibt mit verständlicher Fehlermeldung erhalten. Nach Erfolg landet man auf der neuen Projektseite und sieht eine kurze unaufdringliche Zusammenfassung; jeder ausgelassene Bereich kann dort später normal eingerichtet werden.

## Umfragen und Formulare

Baue eine reife, zur App passende Formularplattform nach dem Bedienprinzip von Google Forms. Projektverantwortliche sollen ohne technisches Wissen Formulare entwerfen, testen, veröffentlichen, teilen und auswerten können.

### Builder und Versionen

- Sortierbare, duplizierbare Fragen mit Titel, Erklärung und Pflichtfeld.
- Fragetypen: Kurz-/Langtext, Zahl, E-Mail, Datum, Uhrzeit, Ja/Nein, Einfach-/Mehrfachauswahl, Dropdown, Skala, Sterne, Auswahlraster und Datei-Upload; außerdem Text-, Bild- und Abschnittselemente.
- Passende Regeln wie Textlänge, Zahlenbereich, Auswahlbegrenzung, Dateityp/-größe und eigene Fehlermeldung.
- Mehrseitige Abschnitte, optionale Fortschrittsanzeige und bedingte Sprünge nach Einfachauswahl/Dropdown. Verhindere Schleifen und ungültige Ziele.
- Projekt- oder Titelbild, Akzentfarbe, Einleitung, Bestätigungstext und optionaler Abschlusslink; Desktop-/Mobilvorschau, Autosave, Duplizieren und kleine Vorlagen für Terminfindung, Essen und Feedback.

Veröffentlichte Strukturen sind unveränderliche Versionen. Texte und Fristen dürfen redaktionell korrigiert werden; Änderungen an Fragen, Optionen, Regeln oder Sprüngen erzeugen einen neuen Entwurf. Jede Antwort bleibt mit ihrer Formularversion sowie einem Schnappschuss der damaligen Frage- und Optionstexte verbunden.

### Sichtbarkeit, Zugang und Identität

Diese drei Entscheidungen bleiben unabhängig:

1. **Sichtbarkeit:** auf der Projektseite gelistet oder ausschließlich über einen nicht erratbaren Link.
2. **Zugang:** nur aktive Projektteilnehmer, alle angemeldeten Accounts mit Link oder Gäste mit Link.
3. **Identität:** namentlich, vertraulich oder anonym.

Namentlich verwendet bei Accounts die verifizierte Identität; Gastname und -E-Mail können erforderlich, optional oder aus sein. Vertraulich bedeutet: Verantwortliche sehen Teilnahme und Nicht-Antwortende, die normale Auswertung stellt Antworten aber nicht neben Namen. Anonym bedeutet: Antworten enthalten keinerlei Bezug zu Account, Name, E-Mail, IP oder Einladung. Teilnahmebestätigung und Antwort werden getrennt gespeichert, damit trotzdem „eine Antwort pro Account“ möglich ist. Anonyme Antworten sind anschließend nicht bearbeitbar.

Vor Veröffentlichung fasst die App die Auswahl in Alltagssprache zusammen, etwa „Nicht gelistet · Gäste erlaubt · namentlich · eine Antwort pro Account · schließt am 12. Juni“. Login-Flows kehren zum Formular zurück. Link und QR-Code lassen sich kopieren beziehungsweise anzeigen; eine Linkrotation entwertet den alten Link. Öffentliche Formulare laufen ohne Projekt-Sidebar und erhalten vom Server ausschließlich die veröffentlichte Version und ihr Branding, niemals Mitglieder-, Projekt- oder Ergebnisdaten.

### Laufzeit und Antworten

Der Lebenszyklus lautet **Entwurf → geplant → offen → geschlossen → manuell archiviert**. Öffnen und Schließen funktionieren manuell, zeitgesteuert sowie optional nach einer maximalen Antwortzahl. Eine Frist schließt nur.

- Accounts können zuverlässig auf eine Antwort begrenzt werden. Bei allgemeinen Gastlinks ist das nicht garantiert und wird ehrlich erklärt; Rate-Limit und Browser-Merker sind nur Hilfen.
- Persönliche Einmal-Links ermöglichen eine sichere Gastteilnahme und sind als CSV exportierbar.
- Accountantworten dürfen bei Freigabe erneut bearbeitet werden. Gäste erhalten optional einen geheimen Bearbeitungslink; anonyme Antworten nie.
- Accountentwürfe werden serverseitig, Gastentwürfe lokal gespeichert. Pro Abschnitt wird validiert; optional folgt vor dem Absenden eine Zusammenfassung.
- Nach dem Absenden erscheinen Bestätigungstext, optionaler Link und auf Wunsch eine E-Mail-Kopie. Mailfehler dürfen die gespeicherte Antwort nicht zurückrollen.
- Ausgewählte Projektverantwortliche können Einzel- oder Sammelbenachrichtigungen erhalten, sofern E-Mail eingerichtet ist. Anonymität bleibt auch dort erhalten.

### Auswertung

Die Verwaltung zeigt Status, Sichtbarkeit, Frist und Antwortzahl. Ergebnisse erscheinen als:

- Zusammenfassung mit Zahlen, Prozentbalken, Skalen und kleinen passenden Diagrammen,
- Einzelantworten, soweit der Identitätsmodus sie erlaubt,
- filter- und durchsuchbare Tabelle.

Freitext kann durchsucht und intern als geprüft markiert werden. Exporte berücksichtigen Filter: Antworten als CSV, Uploads optional als ZIP. Dateien werden geschützt geöffnet; Antworten lassen sich einzeln oder gesammelt nach Bestätigung löschen. Eine optionale Teilnehmer-Zusammenfassung darf nach Abgabe oder Schließung erscheinen, veröffentlicht aber nie automatisch Namen, E-Mails, Freitext, Dateien oder leicht deanonymisierbare Kleingruppen.

### Datenschutz

Öffentliche Formulare brauchen serverseitige Validierung, Größenlimits, Rate-Limit, zurückhaltenden Bot-Schutz und optional einen Pflicht-Einwilligungstext mit Link zur vorhandenen Datenschutzerklärung. Uploads liegen geschützt und gefährliche Typen werden nicht im Browser ausgeführt.

Das automatische Audit darf niemals Antwortinhalte protokollieren. Bei anonymen Antworten darf auch kein Audit-, Fehler-, Mail- oder Exportdatensatz Antwort und Person, IP, Anfrage oder Einmal-Link zusammenführen; erlaubt ist höchstens „anonyme Antwort eingegangen“. Jede Ansicht erklärt klar Identitätsmodus, Empfängerkreis, Bearbeitbarkeit, Ergebnisfreigabe und Laufzeit.

### Dashboard

Ergänze das verschieb- und ausblendbare Widget **Aktive Umfragen**. Es zeigt projektübergreifend nur offene, für diesen Account bestimmte und auf der Umfrageseite gelistete Formulare; reine Link-Formulare bleiben unsichtbar. Unerledigte Einträge stehen zuerst und zeigen Projekt, Titel, Frist sowie „nicht begonnen“, „Entwurf“ oder „beantwortet“. Baldige Fristen werden dezent markiert, erledigte Antworten verschwinden nach kurzer Bestätigung aus dem Vordergrund. Das Widget bleibt kompakt und verlinkt zu „Alle Umfragen“; der Navigationspunkt kann die Zahl noch offener Antworten zeigen.

Eine kleine serverseitige persönliche Aufgaben-Zusammenfassung liefert dafür nur erlaubte Metadaten und den eigenen Status, nie fremde Antworten. Sie kann später auch eine fehlende Zimmerwahl aufnehmen. Bei anonymen Formularen wird nur die getrennte Teilnahmebestätigung ausgewertet.

## Probenwochenende

Mehrere Wochenenden pro Projekt sind möglich. Jedes hat Titel, Zeitraum, Ort, Kurzbeschreibung, optionalen externen Anmeldelink und den Status Entwurf, veröffentlicht, geschlossen oder manuell archiviert. Die veröffentlichte Übersicht zeigt aktiven Projektteilnehmern die allgemeinen Informationen und den Anmeldelink, sofern dieser vorhanden ist. Beim Öffnen eines Wochenendes erscheint darunter ein eigenes Layout wie bei Event oder Stück mit genau zwei Unterseiten:

1. **Teilnehmende** – nur für Projektverantwortliche.
2. **Zimmer** – für Projektverantwortliche und bestätigte Wochenendteilnehmer.

Existiert nur ein zugängliches Wochenende, wird es direkt geöffnet; sonst erscheint zuerst eine schlichte Auswahl. Normale Projektmitgliedschaft reicht für Übersicht und Anmeldelink, gibt aber keinen Zugriff auf Zimmer, Belegung oder Kontakte: Dafür ist ein bestätigter Eintrag in der Teilnehmerliste des veröffentlichten Wochenendes nötig.

### Teilnehmende und Import

Die Teilnehmerliste ist eine eigene Datenbasis und verändert Projektmitgliedschaften nicht. Ein Eintrag ist entweder bestätigt und mit Mitglied beziehungsweise Account verknüpft, als bestätigter Gast ohne Account angelegt oder noch ungeklärt. Nur bestätigte Einträge erhalten Zimmerzugriff.

- Importiere CSV oder eingefügten Text mit Namen und/oder E-Mails, getrennt durch Zeilen, Kommas oder Semikola. Zeige immer zuerst eine Vorschau.
- Gleiche zuerst über verknüpften Account beziehungsweise eindeutige E-Mail, danach über normalisierten Namen und optional Gruppe ab. Ignoriere Großschreibung, Akzente, Satzzeichen und ß/ss. Mehrdeutige Treffer werden nie automatisch übernommen.
- Teile die Vorschau in **sicher erkannt**, **muss bestätigt werden** und **nicht erkannt**.
- Unbekannte lassen sich manuell einem Mitglied zuordnen, nur als Wochenend-Gast anlegen oder bewusst als neues Projektmitglied übernehmen. Gäste ohne Account können nur von Verantwortlichen einem Zimmer zugeteilt werden.
- Wiederholte Imports sind idempotent und zeigen bestehende Einträge statt Dubletten. Danach zeigt die Liste Verknüpfungsart und Zimmerstatus; manuelles Hinzufügen und Entfernen wirkt nur auf das Wochenende.

Protokolliere Quelle/Dateiname, Zeitpunkt, importierende Person sowie neue, wiedererkannte, manuell zugeordnete und übersprungene Zeilen. „Letzten Import rückgängig“ entfernt nur damals neu erzeugte, seitdem nicht manuell veränderte oder gebuchte Wochenend-Einträge. Betroffene spätere Änderungen werden zur Prüfung angezeigt, niemals still gelöscht.

### Zimmer

Projektverantwortliche erstellen und sortieren Zimmer mit Name, Beschreibung und positiver Kapazität. Jede Karte zeigt beispielsweise „3 von 4 Plätzen“. Belegte Zimmer dürfen nicht still gelöscht oder unter ihre Belegung verkleinert werden; Verantwortliche können Personen manuell platzieren und verschieben.

Teilnehmer sehen Zimmer als kompakte Karten mit freien Plätzen, Namen und Bildern der Belegung. Das eigene Zimmer ist hervorgehoben; man kann sich in ein freies Zimmer setzen, wechseln oder den Platz freigeben. Volle Zimmer bleiben sichtbar. Ein Wechsel ist atomar: Zielkapazität prüfen, neuen Platz setzen, alten freigeben – alles oder nichts. Ist das Ziel inzwischen voll, bleibt der alte Platz bestehen.

Ein Klick auf eine Person öffnet Bild, Name, Gruppe und erlaubte Kontakte mit vorhandenen Direktaktionen. Jeder Kontakt erhält die Freigabe **privat**, **für bestätigte Teilnehmer dieses Wochenendes** oder **nur für Personen im eigenen Zimmer**. Ohne Freigabe erscheint ein freundlicher Hinweis. Die allgemeine Kontakttabelle wird nicht geöffnet; eine enge Serverabfrage liefert ausschließlich die im konkreten Verhältnis erlaubten Kontakte.

## Konzert

Baue einen ruhigen, gut lesbaren Bereich für mehrere Konzerte pro Projekt. Projektverantwortliche verwalten Titel, Termin, Ort, Beschreibung, Dresscode sowie Entwurf/Veröffentlichung. Das nächste Konzert steht oben; vergangene bleiben sichtbar und bearbeitbar, bis sie bewusst archiviert werden. Teilnehmer sehen nur veröffentlichte Konzerte.

Jedes Konzert hat ein eigenes, sortierbares Programm unabhängig von Probenprogrammen: Projektstücke, freie Überschriften, Pause und Zugaben. Stücke verlinken auf ihre bestehende Seite.

Aufnahmen können als geschützte Datei oder externer Link dem Konzert oder einem Programmpunkt zugeordnet, sortiert und direkt als Audio/Video abgespielt werden. Sie sind nie öffentlich. Wie Stückdateien verwenden sie einen Papierkorb mit Wiederherstellung und ausdrücklichem endgültigem Löschen; fehlende oder verwaiste Dateien werden erkannt.

## Kleiner Bestands-Fix: Stück-Auswertung

Die Unterseite **Auswertung** innerhalb eines Projektstücks erscheint für Projektverantwortliche nur, wenn für dieses Stück Training eingerichtet ist. Verwende dafür exakt dasselbe vorhandene Signal wie beim Menüpunkt **Training** und keine zusätzliche Einstellung. Ist Training deaktiviert oder wird es später entfernt, verschwinden die Auswertungsseite und ihr Menüpunkt sofort; ein alter Direktlink führt zurück zur Stückübersicht und löst keine Auswertungsabfrage aus. Die bisherigen Rollenregeln bleiben unverändert.

## Navigation

Die Projekt-Sidebar lautet: Meine Teilnahme, Umfragen, Probenwochenende, Konzert, Stücke, danach die bestehenden Verwaltungsseiten. Gruppen und Zuständigkeiten bleiben gemeinsam in der Gruppenverwaltung. Projektverantwortliche sehen die neuen Bereiche immer. Für Teilnehmer gelten diese Regeln:

- **Umfragen** erscheint nur bei mindestens einem veröffentlichten und ausdrücklich gelisteten Formular. Link-Formulare bleiben aus Navigation und Dashboard heraus.
- **Probenwochenende** erscheint bei einem veröffentlichten Wochenende, wenn die Person aktives Projektmitglied oder bestätigter Wochenendteilnehmer ist. Nur Bestätigte sehen die Zimmer.
- **Konzert** erscheint, sobald mindestens ein Konzert veröffentlicht ist.

Badges zeigen höchstens eigene offene Umfragen oder eine fehlende Zimmerwahl und bleiben optisch zurückhaltend.

## Mobiles UI-Remake der Sidebar

Ersetze die mobile Schubladen-Sidebar überall durch eine ruhige, dreistufige Navigation am oberen Bildschirmrand. Es gibt keine zusätzliche untere Navigation. Desktop-Sidebars bleiben unverändert; Seiten ohne Sidebar, öffentliche Formulare und echte Vollbildansichten behalten ihr eigenes Layout.

```text
[ Zurück ]      [ App-Logo · App-Name ]      [ Admin · Account ]
[ Bild/Icon ]     Kontexttitel und Metadaten
[ Seite 1 ] [ Seite 2 ] [ Seite 3 ] [ … horizontal wischbar ]
```

### App-Header

- Links sitzt der Zurück-Button. Er führt zuverlässig genau eine Ebene zurück, etwa vom Stück zu den Stücken oder von der Probe zu den Proben, statt von einem zufälligen Browser-Verlauf abzuhängen. Account- und Admin-Einstellungen kehren zu der Seite zurück, von der sie über das Header-Icon geöffnet wurden; bei einem Direktaufruf gilt ein sicherer Startseiten-Fallback. Gibt es keine sinnvolle übergeordnete Seite, bleibt der Platz frei.
- Logo und App-Name stehen bezogen auf den gesamten Bildschirm optisch exakt in der Mitte, nicht nur im Platz zwischen den Aktionen. Auch zwei Icons auf der rechten Seite dürfen die Marke nicht verschieben.
- Rechts führt ein Account-Icon immer zu den persönlichen Einstellungen. Admins sehen unmittelbar daneben zusätzlich das Icon für die Admin-Konfiguration; für alle anderen fehlt es vollständig. Abmelden liegt in den Account-Einstellungen und muss nicht zusätzlich in der mobilen Navigation erscheinen.
- Der Header berücksichtigt die Safe Area. Icon-Buttons und andere mobile Bedienelemente erhalten mindestens 44 × 44 Pixel Trefferfläche; Eingaben und normale Buttons werden ebenfalls etwas höher, ohne die Desktop-Dichte zu verändern.

### Kontext-Header

Hatte die bisherige Sidebar einen eigenen Kopf, erscheint dessen Inhalt direkt unter dem App-Header: beispielsweise Projektbild und Projektname, Probenname mit Datum und Uhrzeit, Stücktitel mit Komponist und Beschreibung oder Icon und Titel eines Einstellungsbereichs. Es werden dieselben Informationen wiederverwendet und keine neuen erfunden. Der allgemeine App-Bereich braucht keinen zweiten Kopf, weil seine Marke bereits im App-Header steht. Lange Inhalte bleiben kompakt und umbrechen oder werden sinnvoll gekürzt, ohne wichtige Titel zu verstecken.

### Horizontale Seitennavigation

Alle für die Person erlaubten Seiten der jeweiligen Sidebar stehen direkt darunter als adaptive horizontale Reihe aus gut greifbaren, abgerundeten Schaltflächen mit Icon und Text. Sie verwendet die vorhandenen Farben und wirkt wie eine zusammengehörige Seitennavigation, nicht wie eine Reihe beliebiger Karten.

- Passen alle Einträge bequem in die verfügbare Breite, werden sie gleichmäßig verteilt und die Reihe scrollt nicht. Erst bei mehr oder längeren Einträgen erhält jeder Button seine gut lesbare Mindestbreite und die Reihe wird horizontal wischbar.
- Die scrollbare Variante lässt sich natürlich mit dem Finger wischen, hat dezentes Scroll-Snapping und kleine Randverläufe als Hinweis auf weitere Einträge. Eine sichtbare Scrollbar oder zusätzliche Pfeilbuttons sind auf dem Handy nicht nötig.
- Antippen wechselt die Seite; eine Wischgeste scrollt nur die Navigation und wechselt nicht unbemerkt den Seiteninhalt. So kollidiert sie nicht mit Zurück-Gesten, Formularen oder horizontalen Inhalten.
- Der aktive Eintrag ist deutlich, aber ruhig hervorgehoben und wird nach Navigation oder Neuladen automatisch vollständig ins Sichtfeld gescrollt. Badges und Warnhinweise bleiben erhalten.
- Die Reihenfolge und Zugriffsregeln bleiben dieselben wie in der Desktop-Sidebar. Mobile Nutzer sehen keine zusätzlichen Seiten. Der Admin-Konfigurationsbutton ist die bewusst festgelegte Ausnahme und sitzt für Admins oben rechts neben dem Accountzugang.
- Die Navigation funktioniert auch per Tastatur und Screenreader. Fokus, aktive Seite und Bezeichnung müssen eindeutig erkennbar sein.

Der App-Header bleibt beim Scrollen oben. Der Kontext-Header darf mit dem Inhalt aus dem Blick laufen; anschließend bleibt die Seitenreihe direkt unter dem App-Header haften. Dafür ist keine animierte Verkleinerung nötig. Seiteninhalt beginnt immer unter der tatsächlich sichtbaren Navigation und darf von ihr nicht verdeckt werden.

Baue dieses Verhalten einmal als gemeinsame mobile Navigationsschale für App-, Projekt-, Probe-, Stück-, Account- und Admin-Bereiche. So erhalten auch die neuen Bereiche Umfragen, Probenwochenende und Konzert automatisch dieselbe mobile Bedienung, ohne jeweils eigene Sonderlösungen zu brauchen.

## Umsetzung und Abschluss

Nutze vorhandene Komponenten und Muster sowie neue, sauber abgegrenzte Migrationen, serverseitige Zugriffsregeln, Audit-Ereignisse und geschützte Dateien. Ergänze alle Texte auf Deutsch, Englisch und Finnisch und aktualisiere die FUNCTIONAL-SPEC.md einschließlich der bestehenden fünf Rollen. Berücksichtige leere, ladende, erfolgreiche und fehlerhafte Zustände, mobile Nutzung sowie grundlegende Tastaturbedienung.

Externe Umfrageanbieter, eingebettete Google Forms und Webhooks gehören ausdrücklich nicht zu diesem Umfang.

Behandle den kleinen Stück-Auswertungs-Fix als eigene, vorgezogene Änderung. Setze danach die gemeinsame mobile Navigationsschale um, damit alle neuen Seiten sie direkt verwenden. Danach folgen gemeinsame Grundlagen, Gruppen-Zuständigkeiten und Konzert; anschließend Umfragen mit Builder, Veröffentlichung und Accountantworten, dann Auswertung, CSV und Dashboard, Gastzugang, Anonymität, Einmal-Links und Verzweigungen sowie zuletzt Uploads, ZIP, Vorlagen und E-Mails. Danach folgen Probenwochenende und das Onboarding. Das Onboarding kommt zuletzt, damit es die bereits fertigen Formulare und Aktionen der einzelnen Bereiche wiederverwendet. Jede Etappe muss für sich benutzbar bleiben.

Prüfe am Ende nur mit `npm run lint` und `npm run build`. Starte keine aufwendigen Container- oder Browser-Teststrecken, solange es kein konkretes Problem gibt. Fasse danach kurz zusammen, was umgesetzt wurde und welche bewusst nicht enthaltenen Erweiterungen noch offen sind.
