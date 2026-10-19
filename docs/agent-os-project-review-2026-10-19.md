# Agent OS: Produkt- und Umsetzungsreview

Stand: 19. Oktober 2026. Geprüfte Basis: PR #34,
`6bfccfef9593f48a42c6885dfd99659942c01b62`.
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
| Plan verstehen und ändern | Titel und JSON-Parameter bestehender Schritte bearbeitbar; lokale Eingabefehler jetzt korrigierbar | Einfügen, Entfernen, Umordnen von Schritten und natürlichsprachliches Umplanen fehlen |
| Memory-Graph, Suche und begleitende Liste | Memory-/Skill-Graph, Auswahl, Zoom und Herkunftsdetails existieren | Gemeinsame Suche und vollständige synchronisierte Notizenliste fehlen; Kantenmodell transportiert nur Quelle/Ziel, keine individuelle Beleg-/Konfidenzinformation |
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
- Gezielte lokale UI-Regression: 11 Testdateien, 41 bestandene Tests, einschließlich
  der sechs neuen Fälle und der vorhandenen Onboarding-Connector-Prüfung.
- Renderer- und Windows-Harness-Typecheck, gezieltes ESLint sowie
  Vite-Produktionsbuild lokal erfolgreich. Das ist ein
  Renderer-Build auf Linux, kein vollständiges Electron-/Windows-Installationspaket.
- Die Windows-DPI-Suite wurde um Navigation zum Ergebnisse-Einstieg, kompakte
  Ergebnisansicht, Such-/Vorschauablauf und korrigierbare Plan-JSON-Fehler erweitert.
  Diese neuen Windows-Fälle sind vorbereitet, noch nicht ausgeführt.
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
| P1 | Planeditor für normale Nutzer | Strukturierte Felder für unterstützte Werkzeuge; DAG-Änderungen mit Abhängigkeitsprüfung; jede Änderung erzeugt eine neue freizugebende Revision |
| P1 | Memory-Ansicht wie vereinbart vervollständigen | Graph und Notizenliste verwenden dieselbe Suchmenge; Auswahl bleibt sichtbar; deklarierte und lexikalisch abgeleitete Beziehungen haben nachvollziehbare Herkunft |
| P1 | Visuelle Konsistenz und Lokalisierung | Bestehende englische Alttexte und eigene Steuerflächen schrittweise auf gemeinsame Primitives/Übersetzungen migriert; reale kleine Fenster, lange Texte und Tastaturbedienung geprüft |
| P2 | Langzeitbetrieb und große Datenmengen | Messungen zu Reconnect, Wiederaufnahme, Hintergrundarbeit, vielen Missionen, Cachebedarf und Antwortzeiten; keine unbewiesenen Prozent-Fortschrittswerte |
| Release | Produktionsfreigabe | Geschützte, konsolidierte Quelle, Signierung und vollständige Qualifikation am exakten Releasekandidaten |

Der derzeitige Status lautet **weiterentwickelter Testkandidat mit offenen
Windows- und Nutzerabnahmen**, nicht „V1 vollständig fertig“.
