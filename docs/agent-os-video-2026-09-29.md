# Ergänzende Videoauswertung und Umsetzungsentscheidung

Stand: 29. September 2026. Referenz: [Julian Goldie, Hermes Agent OS Makes Your AI 100X More Powerful](https://www.youtube.com/watch?v=YDf_wy6ITDc), veröffentlicht am 28. September.

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
| Ziel → Plan prüfen → starten → Ergebnis prüfen | Sehr hoch | Dauerhafter Entwurf, explizite Aktivierung, Neustartverhalten, UI | P1: nächster zusammenhängender Produktabschnitt |
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
Der neue native Lauf muss diese Diagnose noch bestätigen.

## Nächster Abnahmeabschnitt

Ein Planentwurf muss mit konkreten Schritten, Abhängigkeiten und erwarteten
Ergebnissen sichtbar sein. Freigabe bindet sich an die angezeigte Plan-ID und
Revision. Verwerfen verhindert Start; Wiederherstellung bleibt im Reviewzustand.
Aktionsfreigaben bleiben zusätzlich bestehen. Änderungen an einem Entwurf
erfordern eine neue prüfbare Revision. Erst danach folgt die Ergebnisansicht
mit derselben Auftragsidentität. Diese Funktionen sind hier spezifiziert,
noch nicht als fertig implementiert ausgewiesen.
