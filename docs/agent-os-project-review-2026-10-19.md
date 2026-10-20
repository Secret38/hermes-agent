# Agent OS: Produkt- und Umsetzungsreview

Stand: 20. Oktober 2026. Geprüfte Basis: PR #34,
`6bfccfef9593f48a42c6885dfd99659942c01b62`; Fortsetzung auf
`6b703494d0ec56dca76b7d69dbda88ee5238076c` und
`38a462ea22c85df2284e4552f7e3f3f304ae629c` und
`6c2e08b734a9093085bc1f8c715af25d091a3dcf`.
Die Änderungen dieses Reviews werden auf demselben Integrationsbranch fortgeführt.

## Projektentscheidung

Das nächste Ziel bleibt ein verlässlicher Windows-Nutzertest mit echtem Modell,
Freigaben, Browser-/Computersteuerung und extern prüfbarem Ergebnis. Eine
implementierte Visualisierung ersetzt diesen Ablauf nicht. Der alte Download
aus PR #33 und der erweiterte Quellstand aus PR #34 sind verschiedene Kandidaten.
Änderungen an PR #34 aktualisieren den heruntergeladenen Installer nicht.

Die offenen PRs bilden mehrere historische Integrationsversuche ab. Für diese
Fortsetzung ist die nachvollziehbare Kette PR #32 → #33 → #34 maßgeblich;
keine weiteren parallelen Produktbranches und keine automatischen Merges oder
Schließungen älterer PRs. Vor einem Release muss diese Kette zu einer geprüften
Basis zusammengeführt werden, ohne aktuelle Upstream-Korrekturen zu verlieren.

## Abgleich mit den visuellen Anforderungen

Die Referenzanforderungen stammen aus
[der dokumentierten Videosichtung](agent-os-video-reference-review.md) und
[der ergänzenden Auswertung](agent-os-video-2026-09-29.md).
Die Originalvideos wurden in dieser Runde nicht erneut abgespielt. Der zusätzliche
Abruf früherer Chats ist technisch deaktiviert; fehlende Einzelentscheidungen
wurden nicht erfunden. Die folgende Bewertung prüft Code und lokale Tests,
nicht eine neue bildgenaue Video-Parität.

| Nutzerziel / Referenz | Belegter Stand im Code | Lücke / Entscheidung |
| --- | --- | --- |
| Idee → Plan → Human Gate → Ausführung → Ergebnis | Missionsweg und dauerhafte revisionsgebundene Planprüfung vorhanden | Frische Installation und echte durchgehende Aufgabe weiter P0; kein vollständiger Nachweis aller Videoabläufe |
| Pipeline und Ergebnisansicht als eigene Einstiege | Neu: eigener Ergebnisse-Einstieg in Mission Control, suchbare Missionsliste und Dateidetails nebeneinander | Auf Missionen der aktuellen Übersicht begrenzt; keine vollständige paginierte Dateihistorie |
| Artefakte tatsächlich prüfen und wiederfinden | Vorhandene verifizierte Dateischreibausgaben, Textvorschau, Download und Missions-/Workspace-Identität wiederverwendet | Kein universeller Katalog für Browser-, Terminal-, Bild-, PDF- und Subagent-Ausgaben |
| Plan verstehen und ändern | Titel und strukturierte Datei-, Browser- und Terminalfelder bearbeitbar; erweiterte JSON-Parameter und korrigierbare Eingabefehler | Einfügen, Entfernen, Umordnen von Schritten und natürlichsprachliches Umplanen fehlen |
| Memory-Graph, Suche und begleitende Liste | Gemeinsame Suche über geladene Titel, Notizauszüge und Quellen; Liste aller Treffer, synchronisierte Graph-/Detailauswahl, Inhaltsidentität geprüft | Suche weiterhin auf gelieferte Auszüge bis 1.200 Zeichen begrenzt; vollständige Notiz auf Anfrage lesbar; deklarierende Skills bzw. gemeinsame Begriffe jetzt pro Verbindung vorhanden. Lexikalische Verbindungen sind keine bestätigten Fakten |
| Agenten- und Prozesszusammenhänge | Execution Canvas verwendet vorhandene Plan-/Agent-/Aktionsidentitäten; Zugehörigkeit und Ausführung werden unterschieden | Noch keine vollständige praktische Prüfung mit realer Delegation und komplexen Fehlerfällen |
| Live-Computeransicht und Medienzustände | Live-Ansicht ist ausdrücklich einzuschalten; Frame-Ablauf und falsche Task-Zuordnung werden getestet | Opt-in-Ansicht ist keine belegte vollständige Jarvis-/Wake-Word-/Sprachsteuerungsparität |
| Windows-Bedienbarkeit und visuelle Qualität | Historischer PR33-Stand hatte erfolgreiche DPI-Matrix; neuer Renderer baut lokal | Neue Windows-DPI-Bilder, Tastaturbedienung, High Contrast und Erstinstallation am neuen Commit fehlen |
| Einheitliche Nutzeroberfläche | Neue Ansicht verwendet vorhandene Buttons, Suchfeld, Theme-Tokens und responsive Spalten; neue Texte in allen neun App-Sprachen | Größere Teile des alten Mission-Control-Bildschirms sind weiterhin englisch und enthalten eigene Steuerelemente; kein behaupteter vollständiger Designsystem-Abschluss |

## In dieser Runde behoben

1. **Ergebnisse als eigener Einstieg.** Missionen nach Ziel, ID und Arbeitsbereich
   filtern, eine Mission auswählen und ihre echten Dateinachweise ansehen.
   Nur die ausgewählte Mission wird abgefragt; kein Anfrage-Fächer über alle
   Aufgaben. Bei enger Ansicht stehen Liste und Details untereinander. Eine
   leere Suche und ein fehlgeschlagener Abruf haben unterschiedliche Zustände;
   bei Abruffehlern gibt es eine bewusste Wiederholung.
2. **Planänderungen ohne Verlust nach Tippfehlern.** Ungültiges JSON, JSON ohne
   Objektform und leere Titel werden vor dem Schreiben abgewiesen. Der Entwurf
   bleibt bearbeitbar. Nach einer unklaren Serverantwort ist hingegen weiterhin
   ein explizites Neuladen nötig. Leere Parameterobjekte sind nun ebenfalls
   bearbeitbar. Nach erfolgreicher Speicherung zeigt die Ansicht die vom
   bestehenden API-Pfad bestätigte neue Revision; sie startet nichts automatisch.
3. **Vorschau an Dateinachweis gebunden.** Task-ID, Ergebnis-ID, Pfad und Hash
   der Vorschau müssen zur gewählten Datei passen. Unbekannte Ergebnis-IDs
   werden vor dem Abruf abgelehnt. Das ergänzt die bestehende Prüfung des
   tatsächlichen Dateiinhalts im Backend; Downloads laden weiterhin die aktuelle
   Datei, keine unveränderliche Kopie des früheren Inhalts.
   Ein bewusstes erneutes Öffnen prüft die Vorschau frisch, statt einen noch
   als frisch markierten Query-Cache als erneute Dateiprüfung auszugeben.
4. **Onboarding ohne undeclared Icon-Abhängigkeit.** Der Desktop-Workspace
   importierte `lucide-react`, ohne es selbst zu deklarieren. Ein vorhandenes
   Codicon ersetzt den Import. Es wird kein zusätzliches Paket benötigt.
5. **Memory-Suche und synchronisierte Liste.** Die Liste enthält alle passenden
   geladenen Memory-/Skill-Knoten, unabhängig von der begrenzten Graph-Auswahl.
   Eine Auswahl aus der Liste wird auch außerhalb der bisherigen Graph-Auswahl
   eingeblendet; nach Wegfall des Knotens wird ein gültiger Treffer angezeigt.
   Verknüpfungen im Detail dürfen die Suche bewusst zurücksetzen, um ihr Ziel
   anzuzeigen. Neue Texte sind in allen neun App-Sprachen vorhanden.
6. **Memory-Inhalt korrekt zuordnen.** Der tatsächliche Backend-Vertrag in
   `agent/learning_graph.py` verwendet IDs mit Quelle, Index und Fingerabdruck.
   Die vorherige UI erkannte nur die alte Form ohne Fingerabdruck und zeigte
   deshalb aktuelle Notiztexte nicht. Quelle und Fingerabdruck müssen nun zum
   gelieferten Eintrag passen. Ältere Antworten ohne Fingerabdruck auf beiden
   Seiten bleiben lesbar. Die Suche verwendet gelieferte Auszüge, keinen
   behaupteten Volltext; Beziehungen bleiben als deklarierte oder lexikalisch
   abgeleitete Verbindungen beschrieben, ohne erfundene Einzelbelege.
7. **Vollständige Notizen auf Anfrage.** „Vollständige Notiz lesen“ nutzt den
   vorhandenen `learning.detail`-Gateway-Aufruf. Die Antwort muss zur gewählten
   Memory-ID gehören. Backendseitig wird der Inhaltsfingerabdruck erneut gegen
   die aktuelle Datei aufgelöst. Ladefehler, entfernte/geänderte Inhalte und
   erneutes Laden sind eigene UI-Zustände; während eines Abrufs oder nach Fehler
   wird kein alter Volltext als aktueller Inhalt angezeigt. Query-Schlüssel
   enthalten Verbindung, Profil und Knoten-ID. Der Graph lässt sich explizit
   aktualisieren. Die Suche bleibt eine Suche in den gelieferten Auszügen.
8. **Herkunft einzelner Verbindungen.** Das gemeinsame Graph-Modell liefert
   additive Felder: `declared` mit den tatsächlich deklarierenden Skill-Namen
   aus `related_skills`, oder `lexical` mit gemeinsamen Begriffen und einem
   expliziten Namens-Treffer. Der Ranking-Score ist keine Wahrscheinlichkeit.
   Die Detailansicht zeigt alle Verbindungen in einer begrenzten Scrollfläche.
   Ältere Antworten ohne diese Felder werden als „kein Herkunftsnachweis“
   gekennzeichnet. Es wird keine geprüfte inhaltliche Beziehung behauptet.

## Fortsetzung am 20. Oktober: verständliche Planfelder

Dateipfad und Schreibinhalt, Browserziel sowie Terminalbefehl und Arbeitsordner
sind für unterstützte Operationen über beschriftete Felder bearbeitbar.
Vorhandene textuelle Dateiprüfungen (`content_equals`, `content_contains`) sind
ebenfalls zugänglich. Weitere Parameter bleiben erhalten und über „Erweitertes
JSON“ erreichbar. Unbekannte Werkzeuge behalten ihren bisherigen JSON-Editor.
Bekannte Schwärzungsmarker sperren das jeweilige Feld; die bestehende
serverseitige Prüfung versteckter Werte bleibt maßgeblich.

Leere Pflichtfelder verhindern das Speichern, ohne den Entwurf zu verlieren.
Eine erfolgreiche Änderung bleibt revisionsgebunden und startet keine Aufgabe.
Die Beschriftungen sind in allen neun Sprachen vorhanden. Die Tests prüfen
Feldänderungen, Erhalt zusätzlicher Parameter, JSON-Reparatur, maskierte Felder
und den vollständigen UI-Speichervorgang einschließlich Pflichtfeldkorrektur.
Die Windows-Vorlage benutzt jetzt den tatsächlichen Prüfschlüssel
`content_contains` und bearbeitet Schreibinhalt sowie Erwartung über die Felder.
Dieser native Fall ist vorbereitet, noch nicht ausgeführt.

## Prüfung und Aussagegrenzen

- Der neue Planeditor-Test scheiterte am Ausgangscode nach der JSON-Korrektur;
  der Test für unklare Serverantworten war bereits grün und bleibt erhalten.
- Beide neuen Vorschau-Vertragstests scheiterten am Ausgangscode: abweichende
  Identitäten und unbekannte Ergebnis-IDs wurden nicht abgefangen.
- Ein ergänzter Missionswechsel-Fall scheiterte zunächst am Vorschau-Cache:
  Nach A → B → A zeigte ein erneuter Klick den früheren Text ohne frische
  Dateiprüfung. Jetzt wird erneut geprüft und eine externe Änderung sichtbar abgewiesen.
- Sechs neue Verhaltenstests verwenden echte React-Komponenten, vorhandene
  UI-Primitives und React Query. Die API-Grenze erhält kontrollierte Antworten;
  sie ersetzen keinen echten Modell- oder Windows-Lauf.
- Memory-Fortsetzung: zwei UI-Fälle mit 36 Notizen prüfen Inhaltssuche,
  Quellensuche, Verknüpfungsnavigation, Auswahl außerhalb der Graph-Begrenzung
  und Datenaktualisierung. Beide scheiterten auf der vorherigen UI; die Umstellung
  der Testdaten auf echte Backend-ID-Formate reproduzierte zusätzlich den
  Fingerabdruckfehler. Zwei weitere Tests prüfen Quellen-/Inhaltsidentität,
  ältere Antworten und unveränderte Kartenindizes beim Filtern.
- Gezielte lokale UI-Regression: 15 Testdateien, 49 bestandene Tests einschließlich
  der vorhandenen Onboarding-Connector-Prüfung.
- Weitere UI-Fälle prüfen den bewussten Volltextabruf, Antwortidentität,
  Wiederholung nach Fehler und verspätete Antworten nach Auswahlwechsel sowie
  die Kennzeichnung lexikalischer und unbekannter Herkunft.
- Backend: vier Learning-Testdateien mit 25 bestandenen Tests über
  `scripts/run_tests.sh` in einer isolierten Python-3.14-Umgebung mit aus dem
  Projekt-Lock übernommenen Testabhängigkeiten. Echte temporäre Memory- und
  Skill-Dateien belegen deklarierte/lexikalische Herkunft, vollständige Inhalte,
  A → B → A, Indexverschiebung und Ablehnung veränderter Inhalte.
- Renderer- und Windows-Harness-Typecheck, gezieltes ESLint sowie
  Vite-Produktionsbuild lokal erfolgreich. Das ist ein
  Renderer-Build auf Linux, kein vollständiges Electron-/Windows-Installationspaket.
- Die Windows-DPI-Suite wurde um Navigation zum Ergebnisse-Einstieg, kompakte
  Ergebnisansicht, Such-/Vorschauablauf und korrigierbare Plan-JSON-Fehler erweitert.
  Diese neuen Windows-Fälle sind vorbereitet, noch nicht ausgeführt. Die neue
  Memory-Ansicht hat ebenfalls noch keine native visuelle Abnahme. Ein neuer
  Fall mit echten Seed-Dateien prüft Suche, Volltext und Herkunft bei vier
  DPI-Stufen; die Windows-Lane führt nun auch die Learning-Backendfälle aus. Lokale
  DOM-Tests belegen Interaktionen, keine Pixel- oder DPI-Qualität.
- Der neue Quellstand hat noch keinen erfolgreichen Windows-Workflow. Am
  9. Oktober zeigte GitHub die Fork-Workflows wegen Actions-Nutzung als deaktiviert;
  für den bisherigen PR34-Commit gibt es weiterhin keinen Lauf. Ein erneuter
  Browser-Login wurde in dieser Runde nicht ohne neue Anweisung versucht.

## Priorisierte nächste Arbeit und Abnahmekriterien

| Priorität | Arbeit | Fertig erst bei |
| --- | --- | --- |
| P0 | Windows-Prüfpfad wieder ausführbar machen | Konkreter neuer Commit mit erfolgreichem Installerbau, PowerShell-5.1/7-Prüfungen, Backendfällen und vier DPI-Stufen; tatsächliche Tests nicht übersprungen |
| P0 | Vollständigen Nutzerweg abnehmen | Neuer Windows-Benutzer/VM: Installation → Provider → echte Aufgabe → Plan-/Aktionsfreigaben → Datei extern öffnen; zusätzlich Browser, Notepad, Neustart, Fehler und Reparatur |
| P0 | Einen reproduzierbaren Kandidaten übergeben | Installer-Metadaten und SHA256 passen zum geprüften Commit; Anleitung nennt Grenzen; Update auf eine zweite Version separat geprüft |
| P1 | Vollständige Ergebnis-Historie | Backendseitig paginierte/verifizierte Dateireferenzen mit Mission, Workspace, Suche und Fehlerzuständen; alte Ergebnisse fallen nicht aus dem Suchraum |
| P1 | Planeditor für normale Nutzer | Strukturierte Felder und neue freizugebende Revision implementiert; offen: DAG-Änderungen mit Abhängigkeitsprüfung und natürlichsprachliches Umplanen |
| P1 | Memory-Ansicht wie vereinbart vervollständigen | Suche, synchronisierte Liste, Volltextabruf und individuelle Herkunft implementiert; offen bleiben native visuelle Abnahme und bei Bedarf serverseitige Volltextsuche jenseits der Auszüge |
| P1 | Visuelle Konsistenz und Lokalisierung | Bestehende englische Alttexte und eigene Steuerflächen schrittweise auf gemeinsame Primitives/Übersetzungen migriert; reale kleine Fenster, lange Texte und Tastaturbedienung geprüft |
| P2 | Langzeitbetrieb und große Datenmengen | Messungen zu Reconnect, Wiederaufnahme, Hintergrundarbeit, vielen Missionen, Cachebedarf und Antwortzeiten; keine unbewiesenen Prozent-Fortschrittswerte |
| Release | Produktionsfreigabe | Geschützte, konsolidierte Quelle, Signierung und vollständige Qualifikation am exakten Releasekandidaten |

Der derzeitige Status lautet **weiterentwickelter Testkandidat mit offenen
Windows- und Nutzerabnahmen**, nicht „V1 vollständig fertig“.

## Windows-Nachprüfung am 20. Oktober

Der Testkandidat `b8919b5a5a7cf9b99e95176eaf9164e0a7989192` wurde erfolgreich
als Installer gebaut und mit verifizierter Versionsbindung und SHA256 übergeben.
Die visuellen Läufe bei 125 %, 150 % und 200 % bestanden. Der 100-%-Lauf
scheiterte vorher im Backendtest: Eine parallel laufende Testdatei hielt dieselbe
benutzerweite Desktopreservierung. HERMES_HOME-Isolation isoliert diese bewusst
profilübergreifende Ressource nicht.

Die Fortsetzung gibt jedem Agent-OS-Test eine eigene echte OS-Sperrdatei, gemeinsam
für alle Dienste und Profile innerhalb des Tests. Die produktive Sperre bleibt
unverändert. Existierende Tests prüfen weiterhin Profilkonkurrenz, echte separate
Prozesse und Freigabe nach Prozessende. Push- und PR-Läufe teilen nun eine
Concurrency-Gruppe pro Branch. Die visuelle Prüfung checkt wie der Installer
den exakten Kandidaten-Commit aus, statt den synthetischen PR-Merge zu prüfen.

Lokale YAML-Prüfung erfolgreich. Die lokale Teilumgebung kann die vollständige
Windows-Prüfung nicht ersetzen: Prozessidentitäts- und Prozessende-Tests treffen
auf fehlende Prozessinformationen im Sandbox-Host. Native CI bleibt deshalb
maßgeblich; ein neuer Windows-Lauf muss die Isolation bestätigen.

## Separate Windows test installation (2026-10-20)

START-TEST.cmd selects an empty local folder, rejects occupied/nested existing homes and junctions, and persists the candidate/instance identity. Continue, status and repair resolve that saved home. Desktop shortcuts bind home, Electron data and managed runtime after a fresh login without changing the existing Hermes shortcut or persistent user PATH. The bootstrap also binds these paths for its immediate launch. The candidate NSIS wrapper has a separate product name and identifier. This is folder separation, not VM isolation; Windows components remain shared. Bare EXE invocation does not provide the folder picker. Native Windows suites cover persistence, protected folders and a real child launched through the generated shortcut; acceptance depends on the corresponding CI run and a user installation test.
