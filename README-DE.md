# RadIMO – ReportHalo für Windows

ReportHalo ist ein kleiner, schwebender Begleiter für radiologische Befunde. Er bleibt neben RIS, Word oder Editor; die Zielsoftware bleibt maßgeblich. Text wird bewusst übernommen, vollständig geprüft und anschließend bewusst zurück eingefügt. ReportHalo liest oder steuert keine Fremdfenster.

Die [Produktseite](docs/index.html) enthält eine statische englische Übersicht mit anonymisierten Screenshots. Die Anwendung nutzt die proprietäre, widerrufliche [EULA](EULA.txt) nach dem Lizenzmodell von RadIMO Cortex.

## 3×3-Cub

- oben links: kopierten DMO-/RIS-Text oder Drag-and-drop als Textquelle übernehmen
- oben Mitte: vorhandenen Text klarer formulieren
- oben rechts: Diktat aufnehmen und transkribieren
- Mitte links: relevante Schreib-, Grammatik- und Diktatfehler lektorieren
- Mitte: Statusanzeige und Ziehpunkt; Rechtsklick öffnet Einstellungen und Beenden
- Mitte rechts: geprüften Text für DMO/RIS kopieren
- unten links: vorhandenen Text ordnen
- unten Mitte: `Beurteilung: …` als Ergänzung erzeugen
- unten rechts: vollständigen Entwurf bearbeiten, Zeichen-Diff und Hinweise prüfen

Die rechte Leiste öffnet Text & Chat oder Kontext; die untere Leiste öffnet Chat. Funktionsprompts sind pro Benutzer über Rechtsklick editierbar. `{{TEXT_BLOCK}}` markiert in einem eigenen Prompt die Stelle des aktuellen Textes.

## Sicherer Textablauf

Im DMO/RIS Text markieren, `Strg+C` drücken und **Zwischenablage übernehmen** wählen. Alternativ Text auf das obere linke Feld ziehen oder im lokalen Textfenster bearbeiten. Lektorat liefert den vollständigen korrigierten lokalen Text; medizinische und logische Auffälligkeiten werden darunter und im Chat nur als Hinweise aufgeführt. Eine Beurteilung lässt den vorhandenen Text stehen und erzeugt eine gekennzeichnete Ergänzung. Kein Ergebnis wird automatisch in eine Fremdsoftware geschrieben oder als RIS-validiert bezeichnet.

Die medizinische Schutzschicht bewahrt Zahlen, Einheiten, Seitenangaben, Anatomie, Negationen, Unsicherheiten, Daten, zeitliche Angaben und Empfehlungen. Jeder Entwurf muss vor der Verwendung am Originalbefund und klinischen Kontext geprüft werden. ReportHalo ist kein zertifiziertes Medizinprodukt.

## Varianten und Entwicklung

`npm start` nutzt den lokalen Codex-App-Server mit Abo-Anmeldung. `npm run start:api` nutzt die direkte Responses API und unterstützt OpenAI oder Azure OpenAI. Die API-Version hat lokale Gesprächshistorie sowie vorläufige Tages- und Monatslimits. Zugangsdaten bleiben im Hauptprozess und werden lokal geschützt gespeichert.

```bash
npm ci
npm run check
npm run release:gate
npm run dist:codex       # portable Codex-Version und ZIP
npm run dist:api         # portable API-Version
npm run dist:installer   # Windows-Installer
```

Codex wird nicht eingebettet. Wenn keine offizielle Installation vorhanden ist, liegt dem Release ein geprüfter Installationshelfer bei. Windows SmartScreen kann bei unsignierten Builds warnen.

Neue Releases und die Windows-Dateien liegen unter [GitHub Releases](https://github.com/maxrusse/RadIMO-ReportHalo/releases). Die [UI-Richtlinie](docs/ui-guidelines.md) beschreibt Layout und Workflow.
