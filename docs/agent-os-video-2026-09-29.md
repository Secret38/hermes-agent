# Ergänzende Videoauswertung und Umsetzungsentscheidung

Stand: 30. September 2026. Referenz: [Julian Goldie, Hermes Agent OS Makes Your AI 100X More Powerful](https://www.youtube.com/watch?v=YDf_wy6ITDc), veröffentlicht am 28. September.

## Belegumfang

Gelesen wurden die öffentliche Videobeschreibung und die vom Autor gesetzten
Kapitel. YouTube verlangte für die Wiedergabe eine Anmeldung zur Botprüfung;
der angebotene Transkriptabruf lieferte HTTP 400. Bild, Ton, konkrete Klickfolgen
und Leistungsbehauptungen sind deshalb nicht verifiziert. Die folgende
Bewertung betrifft die belegten Themen und ihre Eignung für unser Projekt.
Sie ist kein behaupteter vollständiger Video-Review.

Die Kapitel behandeln Hintergrundrecherche (0:47), ein gemeinsames Kontrollpult
(1:46), Obsidian als gemeinsamen Wissensbestand (2:09), zielorientierte Aufträge
und ein Ticketboard (3:32), Modellwechsel (4:12) sowie Schutzmechanismen und
lokale Modelle (5:17). Ergänzend nennt der Autor in seinem eigenen
[Dashboard-Artikel](https://juliangoldie.com/best-hermes-agent-dashboard/)
auffindbare Arbeitsergebnisse als zentrale Anforderung.

## Maßstab für unser Agent OS

Ein normaler Windows-Nutzer soll sein Ziel formulieren, den vorgesehenen Ablauf
verstehen, dessen Start bewusst auslösen, Unterbrechungen beantworten und das
prüfbare Ergebnis wiederfinden. Dauerhaftes Wissen soll erneutes Erklären
reduzieren. Welche Aufgabe, welches Profil, welche Rechte und welche Daten
zusammengehören, muss auch nach einem Neustart eindeutig bleiben.

Die folgende Gewichtung ist eine Produktentscheidung aus diesem Ziel und dem
vorhandenen Code, keine gemessene Leistungsbewertung des Videos.

| Idee | Nutzen | Aufwand / Voraussetzung | Entscheidung |
|---|---|---|---|
| Verlässliche Auftragszustände und Kontextzuordnung | Sehr hoch | Bestehende Laufzeitgrenzen absichern | P0: jetzt; Abbruch und Profilgrenzen reparieren |
| Ziel → Plan prüfen → starten → Ergebnis prüfen | Sehr hoch | Dauerhafter Entwurf, explizite Aktivierung, Neustartverhalten, UI | P1: erste Planprüfung implementiert; siehe Folgeabschnitt |
| Ergebnisse zentral wiederfinden | Sehr hoch | Aufgabenbezogene Artefakte, Vorschau und Herkunft | P1: direkt an den Plan-/Ausführungsablauf anschließen |
| Gemeinsam nutzbarer Projektkontext | Hoch | Expliziter Geltungsbereich, Herkunft und Änderungsverlauf | P2: bestehende Memory-/Projektpfade erweitern |
| Hintergrundaufträge und Zeitpläne | Hoch | Laufzeit unabhängig vom Fenster, Wiederaufnahme, Budgets | P2: bestehende Scheduler nutzen; kein zweiter Scheduler |
| Einfacher Modellwechsel | Mittel | Vorhandene Auswahl, Fähigkeiten und Kosten sichtbar machen | P2: vorhandenen Hermes-Pfad verbessern |
| Sprachsteuerung und räumlicher Wissensgraph | Situativ | Zugänglichkeit, überprüfbare Beziehungen, konkrete Nutzung | P3: nach dem durchgehenden Hauptablauf |

Ein gemeinsamer Wissensbestand rechtfertigt keine automatische Vermischung von
Profilen oder Zugangsdaten. Für geteilte Projekte braucht es eine ausdrückliche
Zuordnung. Ein Graph darf nur vorhandene Beziehungen darstellen. Ein
Modellwechsel darf laufende Arbeit und den gecachten Gesprächskontext nicht
unbemerkt neu initialisieren. Lokal laufende Modelle sind außerdem kein
Nachweis gleicher Fähigkeiten oder kostenfreien Gesamtbetriebs. Das
„100X“-Versprechen ist ohne Vergleichsaufgabe und Messung keine Planungsgrundlage.

## Konkrete Fortsetzung in diesem Arbeitsabschnitt

Die bereits vorbereitete Abbruchkorrektur und der TypeScript-Projektcheck wurden
nach Wiederherstellung des Arbeitsplatzes als `13401e8d` in PR #33 hochgeladen.
Sie ersetzen den bei der Speicherbereinigung verlorenen lokalen Commit.
Sieben gezielte Scheduler-/Engine-Tests und der TypeScript-Check bestanden erneut.

Beim Abgleich der Kontextidee wurden zwei weitere Fehler mit echten
temporären SQLite-Datenbanken und Threads reproduziert: Der Dashboard-Endpunkt
cachte einen einzigen Mission-Service für alle Profile; neue und wiederaufgenommene
Mission-Threads übernahmen ihren aufrufenden Profil-/Secret-Kontext nicht.

Die Korrektur hält Services und Freigabebroker pro normalisiertem Profilpfad
und überträgt den Kontext über den vorhandenen Hermes-Threadhelfer. Eine
prozessweite Sperre erhält die serielle Benutzung des interaktiven Desktops.
Ein abgewiesener konkurrierender Start hinterlässt keinen neuen wartenden Job.
Die drei neuen Prüffälle scheiterten zuvor; zusammen mit den neun bestehenden
Mission-Service-Tests bestehen jetzt zwölf Tests. Das prüft die betroffenen
Service-/Threadgrenzen unter A → B → A, keine externe Modellantwort und keine
maschinenweite Sperre zwischen mehreren Backend-Prozessen.

Die erste wirklich befüllte Windows-DPI-Matrix (`36614932679`) erreichte die
Playwright-Prüfungen. Auf 125 % bestanden Navigation, kompakte Tastaturbedienung
und reduzierte Bewegung. Zwei Fokusprüfungen scheiterten: Nach dem zum
Seitenwechsel nötigen Mausklick benutzten sie nur programmatischen Fokus,
der Chromium im Mausmodus nicht zu `:focus-visible` verpflichtet. Die Suite
navigiert für diese Prüfungen nun mit echter Tab-Taste und prüft sowohl Fokus
als auch `:focus-visible`, bevor sie den unverändert geforderten Rahmen misst.
Der native Folgelauf [36616065165](https://github.com/Secret38/hermes-agent/actions/runs/36616065165)
auf `7dc3c38d` besteht in allen vier Skalierungen. Das 100-%-Jobprotokoll bestätigt
fünf bestandene Prüfungen ohne Wiederholung. Normalansicht und High-Contrast-
Screenshot dieses Jobs wurden zusätzlich gesichtet. Der Installer-Kandidatenlauf
[36616065088](https://github.com/Secret38/hermes-agent/actions/runs/36616065088)
ist ebenfalls erfolgreich. Diese Ergebnisse betreffen den Stand vor der neuen
Planprüfung und ersetzen keine Installation auf einem frischen Windows-Rechner.

## Fortsetzung: ausdrückliche Planprüfung

Mission Control erstellt jetzt dauerhafte Entwürfe und zeigt einen eigenen
Prüfschritt vor dem Start. Freigabe bindet sich an die angezeigte Plan-ID und
Revision; SQLite nimmt nur eine Entscheidung über den neuesten Entwurf an.
Verwerfen storniert Plan und Aufgabe zusammen. Neustarts führen keine
ungeprüften Pläne aus. Aktionsfreigaben bleiben zusätzlich bestehen.

Die Ansicht zeigt die vollständigen Schritte, Abhängigkeiten und Parameter;
Geheimwerte werden maskiert. Offene Planprüfungen fallen nicht aus der kurzen
Missionshistorie. Ungültige Antworten und fehlgeschlagene Entscheidungen sperren
die Freigabe bis zum erneuten Laden. Neue Texte sind in allen neun App-Sprachen
vorhanden. Die native DPI-Suite wurde um Planprüfung, Neuladen und Verwerfen
erweitert; ihr Ergebnis für diesen neuen Stand ist noch offen.

Belege und Grenzen stehen in [agent-os-plan-review.md](agent-os-plan-review.md).
Als nächster Produktabschnitt bleiben Änderungen an Entwürfen und eine
Ergebnisansicht mit echten Artefakten unter derselben Auftragsidentität.
