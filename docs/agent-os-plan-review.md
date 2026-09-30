# Mission Control: dauerhafte Planprüfung

Stand: 30. September 2026. Umsetzung auf dem Review-Branch von PR #33.

## Verhalten

„Plan erstellen“ ruft den vorhandenen Planner auf und speichert dessen validierte
Schritte als `DRAFT`. Es startet noch keine Planausführung. „Plan prüfen“ zeigt
Ziel, Arbeitsbereich, Version, alle Schritte, ihre Abhängigkeiten und die
vollständigen Aktionsparameter. Geheimwerte werden maskiert; die ursprünglichen
Ausführungsdaten bleiben im Ledger. Ein Entwurf wird nicht durch die Kürzung
der jüngsten Missionshistorie unzugänglich.

„Freigeben und starten“ gilt ausschließlich für die angezeigte Plan-ID und
Revision. Neuere Pläne, wiederholte Entscheidungen, falsche Zuordnungen und
bereits abgeschlossene Aufgaben werden abgewiesen. Die Entscheidung und ihr
Audit-Ereignis werden in einer SQLite-Transaktion gespeichert. Konkurrierende
Entscheidungen können nicht beide gewinnen. Sensible Einzelaktionen fragen
weiterhin über den vorhandenen Freigabebroker nach.

„Plan verwerfen“ storniert Entwurf und Aufgabe atomar. Das bleibt auch bei
pausierter neuer Arbeit möglich. Ein Start benötigt eine freie interaktive
Laufzeit; deren Reservierung findet vor der Freigabe statt. Scheitert erst der
Threadstart, bleibt die bereits gespeicherte Freigabe erhalten und die Mission
wird als unterbrochen angeboten.

Nach einem Neustart warten ungeprüfte Entwürfe weiter auf Planfreigabe. Dies
gilt auch für einen Abbruch zwischen dem Speichern des vollständigen Entwurfs
und dem abschließenden Intake-Statuswechsel. Bereits freigegebene, unterbrochene
Missionen benötigen weiterhin ein ausdrückliches Fortsetzen. Der allgemeine
Runtime-/CLI-Aufruf behält seinen bisherigen Aktivierungsstandard; nur der
Mission-Control-Intake fordert die zusätzliche Planprüfung an.

## Schnittstellen

| Endpunkt | Bedeutung |
|---|---|
| `POST /api/plugins/agent-os/missions` | Ziel annehmen und Entwurf vorbereiten |
| `GET /api/plugins/agent-os/missions/{job_id}/plan` | Vollständigen gespeicherten Plan zur Prüfung lesen |
| `POST /api/plugins/agent-os/missions/{job_id}/plan/decision` | `{plan_id, revision, choice: "approve" \| "discard"}` verarbeiten |
| `POST /api/plugins/agent-os/missions/{job_id}/resume` | Bereits freigegebene, unterbrochene Mission fortsetzen |

Profil und REST-Authentifizierung kommen weiterhin aus dem vorhandenen
Dashboard-/Plugin-Pfad. Mission-Threads übernehmen den Kontext ihres Profils.
Die Desktopsperre gilt pro Backend-Prozess; mehrere getrennte Prozesse werden
dadurch nicht zu einer maschinenweiten Warteschlange.

## Prüfung

- Die ursprünglichen drei neuen Backend-Prüffälle scheiterten vor der Änderung:
  Intake führte sofort aus und es fehlte die atomare Review-Entscheidung.
- 32 gezielte Python-Fälle bestanden anschließend über `scripts/run_tests.sh`:
  HTTP-Intake, echter Runtime-/Compiler-/SQLite-Pfad, Neustart, Versionsbindung,
  Ablehnung/Wiederholung, konkurrierende Entscheidungen, Profilscope A → B → A,
  bestehende Aktionsfreigaben, Scheduler und bisheriger Compilerstandard.
  Nur die Modellantwort ist im Intake-Test ersetzt; der Ausführungsnachweis
  erreicht einen manuellen Haltepunkt, keine externe Modell- oder Desktopaktion.
- 36 Desktop-Fälle bestanden, einschließlich real gerenderter Planprüfung mit
  gebundener REST-Schnittstelle. Veraltete Entscheidung, ungültige Planantwort,
  bewusstes Neuladen, einmaliger Klick und Verwerfen bei gesperrtem Start sind
  enthalten. Renderer- und Visual-Harness-TypeScript sowie gezieltes ESLint
  wurden geprüft.
- Die lokale Snapshot-Prüfung mit echter Prozess-Fingerprinting-Anforderung
  kann hier mangels `/proc` nicht bestehen. Zwei weitere Projektionsprüfungen
  bestehen; die betroffene Suite läuft zusätzlich in der Windows-Matrix.
- Der Windows-Workflow prüft jetzt die Backend-Fälle auf einem nativen Host
  und die neue Planansicht bei 100/125/150/200 %. Die bisherigen grünen Jobs
  auf `7dc3c38d` enthalten diese Erweiterung noch nicht. Der neue Lauf bleibt
  bis zu seinem Abschluss ein offener Nachweis.

## Verbleibender Umfang

Es gibt noch keinen Editor für einzelne Planschritte: Ein ungeeigneter Entwurf
kann verworfen und als neue Mission erstellt werden. Die Ergebnisgalerie mit
echten Artefakten und die vollständige Erstinstallation, Reparatur und native
Computer-Use-Abnahme auf einem frischen Windows-PC bleiben gesonderte Arbeit.
Diese Änderung ist keine Erklärung der allgemeinen V1-Produktionsreife.
