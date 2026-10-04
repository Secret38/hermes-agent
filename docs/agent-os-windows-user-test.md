# Windows Agent OS: installierbarer Testkandidat

Stand: 4. Oktober 2026. Dieser Kandidat ist für einen begleiteten Nutzertest,
noch nicht als vollständig abgenommener Produktionsrelease bestimmt.
Die genaue Quellversion und die SHA-256-Prüfsumme stehen neben der EXE in
`build-metadata.json` und `SHA256SUMS.txt`.

## Installation

1. Das vollständige Testpaket herunterladen und entpacken.
2. Unter Windows x64 `Hermes-Setup.exe` starten. Das Paket ist unsigniert;
   Windows kann daher einen unbekannten Herausgeber anzeigen.
3. Den Windows-Installationsassistenten abschließen und Hermes starten.
   Die NSIS-Hülle richtet bei Bedarf WebView2 ein. Im anschließenden
   Hermes-Fenster `Install` wählen und auf den Abschluss warten.
   Eine Internetverbindung ist notwendig: Laufzeit, Quellstand und benötigte
   Komponenten werden nachgeladen. Dies ist kein Offline-Installer.
4. `Launch` wählen. Die Modelleinrichtung in Hermes abschließen; Modellzugang
   und gegebenenfalls dessen Kosten sind nicht Bestandteil dieses Installers.
5. `Agent OS` öffnen. Vor dem Start einer Mission muss die Laufzeit bereit sein.

Die eigentliche Hermes-Installation liegt standardmäßig unter
`%LOCALAPPDATA%\hermes`. Ein bereits gesetztes `HERMES_HOME` hat Vorrang.
Ein neuer Testbenutzer oder eine frische Windows-VM verhindert, dass eine
vorhandene produktive Hermes-Installation durch diesen Test verändert wird.

## Erster Test

Einen leeren lokalen Testordner anlegen und seinen absoluten Pfad verwenden:

> Erstelle im Testordner eine Datei test-ergebnis.txt mit dem Inhalt
> "Mein erster Agent-OS-Test". Lies sie anschließend erneut und prüfe den
> genauen Inhalt. Verwende keine weiteren Ordner.

- Ziel eingeben, `Plan erstellen` wählen. Noch keine Datei darf entstehen.
- `Plan prüfen` öffnen und Pfade, Inhalt und Prüfung ansehen.
- `Schritte bearbeiten` erlaubt Titel und Aktionsparameter einzelner Schritte
  zu ändern. Die Parameteransicht verwendet JSON. Abhängigkeiten und Schrittarten
  bleiben erhalten. Speichern erzeugt eine neue, noch nicht freigegebene Version.
- App vor der Freigabe schließen und erneut starten: Der Entwurf muss weiterhin
  auf Prüfung warten. Erst `Freigeben und starten` startet die Arbeit.
- Etwaige Einzelaktionsfreigaben bewusst beantworten.
- Unter der Mission `Ergebnisdateien` öffnen. Verifizierte Ausgaben des Dateiwerkzeugs
  erscheinen mit Pfad und Prüfzeitpunkt. `Vorschau` liest die Datei erneut und
  vergleicht sie mit dem gespeicherten Inhaltsnachweis. `Datei herunterladen`
  nutzt den vorhandenen authentifizierten Download der Desktop-App.
- Die heruntergeladene Datei auch außerhalb von Hermes öffnen und Inhalt prüfen.

Die Ergebnisliste belegt einzelne geprüfte Dateiausgaben; sie bedeutet nicht,
dass alle Schritte der Mission erfolgreich abgeschlossen sind. Der Download
holt die aktuelle Datei. Wurde sie seit der Prüfung verändert, lehnt die
Vorschau den alten Nachweis ab. Textvorschauen sind auf Dateien bis 2 MiB und
32.000 angezeigte Zeichen begrenzt; Geheimwerte werden in der Vorschau maskiert.

## Bei Problemen

Im Installer `Open logs` wählen. Die Protokolle liegen standardmäßig unter
`%LOCALAPPDATA%\hermes\logs`, darunter `bootstrap-installer.log`.
`Retry install` wiederholt einen fehlgeschlagenen Installationslauf.
Eine ausdrücklich als unterbrochen angebotene Mission kann über `Resume`
fortgesetzt werden. Eine blockierte oder fehlgeschlagene Aufgabe darf nicht
allein durch eine Statusänderung als erfolgreich gelten.

Für eine gezielte Reparatur ist der bestehende Bootstrap-Aufruf verfügbar:

```powershell
& "$env:LOCALAPPDATA\hermes\hermes-setup.exe" --repair
```

Bei abweichendem `HERMES_HOME` den entsprechenden Pfad verwenden. Reparatur,
Update, Neustart und echte Browser-/Computeraktionen gehören weiterhin zur
Abnahme auf einem frischen Windows-PC. Der Build- und UI-Test ersetzt sie nicht.
Beim Melden eines Problems: Windows-Version, letzter sichtbarer Schritt,
Fehlermeldung und die relevante Logstelle angeben; Zugangsdaten nicht mitsenden.

## Grenzen dieses Kandidaten

- Planänderungen sind direkte Bearbeitungen bestehender Schritte; Einfügen,
  Entfernen, Umordnen und natürlichsprachliches Umplanen sind nicht enthalten.
- Die Ergebnisliste erfasst verifizierte Schreibaktionen des Dateiwerkzeugs.
  Ein allgemeiner Artefaktkatalog für beliebige Terminal-/Browser-/Subagent-Ausgaben,
  Bild-/PDF-Vorschauen und projektweite Suche sind noch offen.
- Vollständige Wiederaufnahme jeder Fehlerklasse, alle Referenzvideo-Abläufe,
  die maschinenweite Sperre über mehrere Backend-Prozesse und die frische
  Windows-End-to-End-Abnahme sind noch offen.
- Kein signierter Produktionsrelease und keine automatische Zusammenführung
  des Review-Branches. Signierung und Produktionsfreigabe behalten ihre Gates.
