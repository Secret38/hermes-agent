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
  Präzisierung: `MissionControlActions` → `/missions` →
  `MissionControlService.submit` → `runtime.submit_goal/run_until_idle` ist
  bereits ein angeschlossener Missionsweg mit Aktionsfreigaben. Offen ist die
  einheitliche Video-Pipeline mit einer ausdrücklich sichtbaren Planfreigabe
  vor Ausführung und einer zugehörigen Ergebnisgalerie. Die ungenutzte Capture-
  Schnittstelle bedeutet nicht, dass Mission Control überhaupt keine Arbeit startet.
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

## Folgeprüfung vom 28. September 2026: Installationsblocker

Der Installer-Build für `b9f512e4` war erfolgreich. Das heruntergeladene ZIP
enthält die EXE, `SHA256SUMS.txt` und `build-metadata.json`; EXE-Prüfsumme und
Commit-Zuordnung stimmen überein. Das ist ausdrücklich kein Installationsnachweis.
Der Bootstrapper lädt `scripts/install.ps1` vom eingebetteten Commit nach.

Die erneute Prüfung fand im Commit `2587d76d` eine beschädigte Repository-Prüfung:
Zwei zusätzliche Kopien des Skriptkörpers waren mitten in Regex-Ausdrücke geraten.
Der alte Kandidat ist deshalb nicht für den Benutzertest empfohlen.

Die Folgereparatur entfernt ausschließlich diese Duplikate, vervollständigt
die Slug-Prüfung und erhält die beabsichtigte Repository-Bindung bei Reparaturen.
Der Kandidaten-Workflow muss nun vor dem Build das echte Protokoll und die
Repository-Bindung unter Windows PowerShell 5.1 und PowerShell 7 ausführen.
Die Protokollprüfung startet das Installationsskript als Kindprozess, liest die
Manifeste mit und ohne Desktop und prüft, dass Abfragen keine Installation anlegen.
Der Windows-DPI-Workflow erfasst jetzt auch SDK-, Kanban- und gemeinsame
Operations-Vertragsänderungen.

Lokal bestätigt: Die generierten Bootstrap-Pins sind unverändert aktuell und
der reparierte Skriptkörper entspricht bis auf die beabsichtigte Repository-
Bindung dem Stand vor der Beschädigung. PowerShell konnte auf diesem Linux-Host
nicht starten (`Failed to create CoreCLR`); native Windows-Ergebnisse bleiben
bis zum abgeschlossenen CI-Lauf offen.

Die folgende Integrationsänderung fügt für `-IncludeDesktop` wieder eine
verbindliche `agent-os-runtime`-Stufe vor `complete` ein. Sie ruft über die
installierte Hermes-Runtime `agent-os provision --production-security` und
anschließend `agent-os status --require-full --require-production-security --json`
auf. Ein fehlgeschlagener Prozess, ungültiges JSON oder fehlende Bereitschaft
verhindert den erfolgreichen Stufenabschluss. Reine CLI-Installationen enthalten
diese Stufe nicht. Das Desktop-Profil setzt die dokumentierte strenge
Freigabe-/Scannerkonfiguration; es benötigt Netzwerkzugriff für fehlende Runtimes.

Die bisherigen drei Quelltext-Tests gegen den veralteten Skriptaufbau werden
durch eine native PowerShell-Verhaltenssuite ersetzt: realer Installerdispatcher,
realer Kindprozess und temporäre CLI-Fixture für Erfolg, Provisionierungsfehler,
Statusfehler, ungültiges JSON, fehlende Automation und fehlende Sicherheitsbereitschaft.
Das prüft die Verbindung und Fehlerweitergabe, nicht die echte Browser-/CUA-Installation.
Auch diese Suite ist vor der Paketierung unter beiden PowerShell-Versionen Pflicht.
Der erste native Lauf fand einen PowerShell-5.1-Fehler im neuen Testpfad-Default;
die Pfadauflösung erfolgt nun nach der Parameterbindung. Noch kein neuer
Installer wird vor einem grünen nativen Lauf als verwendbar bezeichnet.

**Nativer Zwischenbeleg:** Workflow `36387500605` auf `e6a9675d` hat die
Protokoll-, Repository- und Runtime-Stufensuites unter PowerShell 5.1 und 7
erfolgreich ausgeführt. Der vollständige EXE-Build und die DPI-Abnahme waren
zu diesem Zwischenstand noch laufend. Eine zusätzliche Regression prüft nun
auch, dass `-SkipBrowser` bis zur Provisionierung erhalten bleibt: kein
unbeabsichtigter Browserdownload, aber weiterhin keine falsche Full-Ready-Meldung.

Weiter offen: Der Erststart muss Provider-Einrichtung, Runtime-Bereitschaft und die gewünschte
Kanban-Aktivierung verständlich zusammenführen. Danach folgt der durchgehende
Capture-/Plan-/Freigabe-/Ergebnis-Ablauf; reine Datenprojektionen reichen nicht.

## Windows-Nachprüfung: tatsächliche DPI und Testdaten

Auf `b324a5d8` ist der Installer-Workflow `36387823509` vollständig erfolgreich.
Die DPI-Matrix `36387823417` scheiterte jeweils am fehlenden RUNNING-Statuspunkt.
Die vier übrigen Tests pro Job liefen grün, sind jedoch kein belastbarer
Nachweis der beschrifteten Skalierungen oder einer gefüllten Oberfläche:
`setupMockBackend` ignorierte die vom Test übergebenen Optionen `launchArgs`
und `prepareSandbox`. Der Screenshot bestätigt eine leere Aufgabenliste.

Die Reparatur verbindet beide Optionen mit dem tatsächlichen Electron-Start.
Die Vorbereitung erhält dieselbe isolierte Umgebung wie die App. Die Suite
prüft nun `window.devicePixelRatio` gegen die gewünschte Skalierung und verlangt
vor jedem Test einen sichtbaren laufenden Aufgabenstatus auf der Übersicht.
Der Bewegungstest prüft zuerst eine aktive Animation und dann deren Reduktion.
Eine gezielte strikte TypeScript-Prüfung des E2E-Einstiegs läuft künftig in CI;
der normale Renderer-Typecheck schließt E2E-Dateien aus und konnte diese
fehlenden Optionen deshalb nicht melden. Fehlerscreenshots und Fehlerkontext
werden zusätzlich zu den bisherigen Beweisbildern archiviert.

## Folgeprüfung vom 29. September 2026: Abbruch und Testkonfiguration

Der Installer-Workflow `36401087447` auf `418a138b` ist erfolgreich. Die
Windows-Visual-Matrix `36401087232` scheiterte vor Playwright an TS5112:
Einzeldateien auf der TypeScript-Kommandozeile kollidieren mit der vorhandenen
Desktop-Konfiguration. Eine eigene `e2e/tsconfig.agent-os-visual.json` erweitert
jetzt die Desktop-Konfiguration und wird mit `tsc -p` vor dem Build geprüft.
Die tatsächlich gefüllte DPI-Matrix ist weiterhin nicht erfolgreich belegt.

Die Planprüfung reproduzierte einen Laufzeitfehler: Nach gespeichertem Abbruch
konnte der Scheduler bereits bereite Schritte beanspruchen; der Engine-Pfad
konnte außerdem eine gebundene, noch nicht gestartete Aktion wiederaufnehmen.
Die Abfrage innerhalb der bestehenden SQLite-Transaktion verlangt nun einen
aktiven Plan. Die Engine prüft den Planstatus auch vor der Wiederaufnahme.
Das verhindert diese Starts nach beobachtetem Abbruch, beendet aber keinen
bereits laufenden externen Prozess und ist keine atomare globale Stop-Garantie.

Vor der Arbeitsplatzbereinigung wurden beide Regressionen zuerst rot, danach
grün geprüft; die vollständige Scheduler-Datei bestand mit acht Tests. Der
veraltete Test auf eine feste Schema-Version prüft nun Migration und erhaltene
Plan-/Schrittbeziehungen. Der gezielte TypeScript-Projektcheck bestand ebenfalls.
Die Bereinigung entfernte den nur lokalen Commit `7ba8bf28` und die Testumgebung.
Die Codeänderungen wurden auf Basis von `418a138b` anhand des dokumentierten
Diffs wiederhergestellt; diese Notiz ersetzt den verlorenen Berichtszusatz.

Nächster Produktschritt: ein dauerhaft gespeicherter Planentwurf, eine bewusste
Freigabe des konkreten Plans und danach Ausführung. Ein Neustart darf die
Planfreigabe nicht ersetzen; Aktionsfreigaben bleiben eigenständig bestehen.
