# Agent OS: Videoreferenzen, Kritik und Integrationsstand

Stand: 27.09.2026. Geprüfte Ausgangsbasis: `Secret38/hermes-agent`,
`agent-os-v1-release-candidate`, `00451cb13fe2ae40bf798bc1243717feb1a4d008`.

## Ziel und Beleggrenzen

Das Produktziel ist ein direkt nutzbares Windows-Kontrollzentrum für echte
Agentenarbeit: Idee erfassen, planen, angemessen freigeben, ausführen, Ergebnisse
prüfen und Kontext wiederverwenden. Sichtbare Zustände müssen auf die jeweiligen
Backend-Daten zurückgehen. Ein implementierter Bildschirm ist noch kein
nachgewiesener End-to-End-Ablauf.

Die beiden hochgeladenen Videos wurden anhand von 49 zeitlich verteilten
Einzelbildern und vergrößerten Schlüsselszenen visuell untersucht. Diese Sichtung
ist keine vollständige Transkription oder lückenlose Prüfung jeder Animation.
Werbeaussagen und gezeigte Dokumentation belegen keine eigene Runtime-Funktion.
Die fehlenden Originaltexte früherer Chats wurden nicht rekonstruiert oder erfunden.

## Referenzen und konkrete Anforderungen

| Referenz | Beobachtung | Konsequenz für Agent OS |
|---|---|---|
| Super Kanban, 02:20 | Idee-Eingabe, Capture, Human Gate, Execute, Shipped & Filed | Ein zusammenhängender Arbeitsablauf mit nachvollziehbaren Zustandsübergängen. |
| Super Kanban, 02:00 / 03:40 | Umschaltung zwischen Pipeline und Ergebnisgalerie | Ergebnisorientierte Übersicht zusätzlich zur Aufgabenansicht; tatsächliche Artefakte anzeigen. |
| Super Kanban, 05:20 | Seitlicher Detailbereich mit Vorschau, Idee, Klassifikation und Plan | Herkunft, Entscheidung und Ergebnis müssen gemeinsam inspizierbar sein. |
| Super Kanban, 05:40 / 06:20 | Memory-Graph, Suche, Auswahl, Zoom/Orbit, begleitende Notizenliste | Graph und Liste müssen dieselben Daten filtern; Beziehungen brauchen eine nachvollziehbare Quelle. |
| Super Kanban, 05:40 | Anzeige: 42 Notizen, 0 Wikilinks, 1 Sammlung | Räumliche Nähe und dekorative Sterne sind kein Beleg semantischer Beziehungen. |
| Super Kanban, 06:00 | Mission Control mit Statuskennzahlen und Agenteneinstiegen | Zentraler Überblick mit Rücksprung in die tatsächlich zuständige Sitzung. |
| Computer Control, 01:20 | Hermes-Seite mit Chat/Talk/Jarvis/Studio/Sessions/Workspace, Orb und Realtime-/Live-/Wake-Word-Schaltern | Sichtbare Medienzustände müssen tatsächliche Aufnahme und Verfügbarkeit wiedergeben; keine unbewiesene Daueraktivität. |
| Computer Control, 01:00–02:00 | Computer-Use-Dokumentation neben der Bedienoberfläche | Native Windows-Ausführung separat praktisch nachweisen. Das gezeigte macOS-Fenster ist kein Windows-Test. |
| Computer Control, 06:00 | Memory-Ansicht mit Graph | Wiederauffindbarkeit und belegte Beziehungen sind wichtiger als reine Animation. |

## Kritik neu gewichtet

| Aussage / Befund | Bewertung am geprüften Stand |
|---|---|
| „Der Fork enthält keine eigenen Änderungen“ | Für diesen Branch widerlegt: `agent_os/`, Desktop-Agent-OS-Plugin und eigene Release-/Test-Integration sind vorhanden. Die historische Aussage über einen anderen Branch/Zeitpunkt bleibt ungeprüft. |
| Shell-Umgehung über `X=rm; $X -rf /` | Die aktuelle Hardline-Erkennung blockiert den String im ausgeführten Regressionstest. Kein destruktiver Befehl wurde ausgeführt. |
| Lesen von Passwort-Hashes und Environment-Upload | Die konkreten Fälle `sudo cat /etc/shadow`, Environment-Pipeline und direkter Shadow-Upload bestehen die aktuellen Erkennungstests. Das beweist keine vollständige Abdeckung aller Interpreter-/Datenflussvarianten. |
| Produktionsfreigaben | Tests prüfen Ablehnung vor Dispatch sowie exakte, nicht umgehbare Tool-Freigabe. Zwei fehlerhafte Testimporte wurden korrigiert, damit die Tests diese Logik tatsächlich ausführen. |
| „V1 ist fertig / UI vollständig geprüft“ | Nicht belegt. Der Ausgangsstand hatte fehlgeschlagene Desktop- und Installer-Builds; Windows-Visual-QA wurde deshalb übersprungen. |

Ausgangsbelege:
- Desktop/Windows-Visual-QA: https://github.com/Secret38/hermes-agent/actions/runs/36314403192
- Windows-Installer: https://github.com/Secret38/hermes-agent/actions/runs/36314403193

## In dieser Fortsetzung umgesetzt

1. Fehlende SDK-Bindings für Mission Control wieder angeschlossen: echte
   Sitzungen, Unteragenten, Freigaben, Projektbaum und vorhandene Workspace-Aktionen.
   Die Implementierungen bleiben in ihren bisherigen Modulen.
2. Kanban-Projektionen aus dem älteren Integrationsstand
   `11048b00bd1a5ea050c71f7fd57f6593bbe0d3ab` übernommen und als eigenes
   `operations.ts` strukturiert. Aktuelle Connection-Scopes wurden erhalten.
3. Kanban registriert wieder eine lesende Operations-Datenquelle für Mission
   Control. Kanban bleibt Eigentümer seiner Aufgaben und Persistenz.
4. Bei expliziter Board-Auswahl stammt die Projektzuordnung vom ausgewählten
   Board. Die Zeit des aktuellen Runs hat Vorrang vor einem älteren Startwert.
5. Antworten eines Operations-Lesevorgangs werden bei inzwischen veränderter
   Verbindung oder verändertem Profil zurückgewiesen.
6. Freigabeantworten verwenden wieder das gemeinsame 300-Sekunden-Zeitlimit.
   Genau eine Wiederholung ist ausschließlich bei Transport-Timeout und einer
   identifizierten Einzelanfrage erlaubt. Sammelfreigaben und Anfragen ohne ID
   werden nicht automatisch wiederholt. Andere Fehler werden weitergereicht.
7. Veraltete Testimporte auf den aktuellen gemeinsamen Timeout-Vertrag umgestellt.
8. Installer-Lockdatei an die Paketversion des vorhandenen Manifests angeglichen
   (`0.0.0` statt `0.21.1`), ohne Abhängigkeitspins zu ändern.

## Noch ausstehende Produkt- und Release-Arbeit

- Gemeinsamer Capture → Plan → Human Gate → Execute → Ergebnis-Ablauf:
  `OPERATIONS_CAPTURE_SOURCES_AREA` ist im Ausgangsstand lediglich definiert,
  aber nicht als Produzent/Verbraucher verbunden. Die hier wiederhergestellte
  lesende Kanban-Quelle schließt diese Schreib-/Orchestrierungslücke nicht.
- Ergebnisgalerie und Detailvorschau mit echten Artefakten durchgängig prüfen.
  Die wiederhergestellten Detail-Projektionen sind noch kein angeschlossener
  Artefakt-Lesezugriff in der Operations-Datenquelle.
- Memory-/Execution-/Runtime-Visualisierungen existieren im Code; Bedienbarkeit,
  Quellenbezug und vollständige Video-Parität sind separat abzunehmen.
- Windows-Installer erneut bauen, Rust-Lockprüfung dort ausführen und die
  visuelle DPI-Matrix 100/125/150/200 % wirklich ausführen.
- Installation, Reparatur, Browser- und natives Windows-E2E am exakten Kandidaten
  nachweisen. Eine Signatur ist für den vereinbarten ersten Benutzertest nicht
  erforderlich; dieser Test ist kein signiertes Production-Release.
- Neues Review-Ergebnis nicht als bestandene Windows-Qualifikation oder
  vollständiges Sicherheits-Audit darstellen.

## Lokale Prüfung dieser Änderung

- Desktop-Renderer-TypeScript: `tsc -p apps/desktop --noEmit` erfolgreich.
- 14 gezielte Desktop-Testdateien: **122 Tests bestanden**. Enthalten sind
  Mission Control, Kanban-Projektionen und Connection-Wechsel, Freigabekarten,
  Benachrichtigungen sowie Einzel-/Sammelfreigabe-Timeouts.
- Python über den kanonischen `scripts/run_tests.sh`: **9 Tests bestanden**
  in `test_agent_os_security_regressions.py` und
  `test_agent_os_production_approval.py`.
- `npm run build` im Desktop-Workspace auf Linux erfolgreich (Exit 0),
  einschließlich Renderer und Electron-Bundles. Der optionale Linux-HUD-Helfer
  konnte mangels X11-Headern nicht gebaut werden; der Build behandelt ihn als
  optional. Das ist kein Windows-Buildnachweis.
- Gezieltes ESLint: keine Fehler; bestehende `document`-Warnungen in den
  Freigabekarten-Tests bleiben sichtbar.
- `git diff --check` erfolgreich.
- Rust/Windows-Ausführung lokal nicht verifiziert. Der verfügbare Linux-Host
  ersetzt weder Cargo-Metadatenprüfung noch einen interaktiven Windows-Desktop.
