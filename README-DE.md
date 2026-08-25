# RadimoAgent für Windows

1. Diesen ZIP-Ordner vollständig entpacken. `RadimoAgent.exe` und `codex/codex.exe` müssen zusammen bleiben.
2. `RadimoAgent.exe` starten.
3. Die Dateien unter `guidance/` dürfen angepasst werden. Besonders wichtig:
   - `german-radiology-profile.md` für Schreibstil, typische Begriffe und Formulierungen
   - `templates/*.md` für lokale Befundvorlagen
4. Nach Änderungen an Markdown-Dateien RadimoAgent neu starten.

Die Anwendung ist in dieser Entwicklungsfassung nicht signiert. Windows SmartScreen oder die Unternehmens-IT können deshalb eine Prüfung anzeigen. Der Codex liegt separat im Unterordner `codex/`, damit die EXE kleiner bleibt.

Die lokale Webserver-Quelle für Vorlagen ist vorbereitet, aber derzeit deaktiviert. Ohne externe Vorlagen verwendet RadimoAgent die eingebauten generischen Vorlagen.

Die KI-Ausgaben bleiben Entwürfe. Befund und Beurteilung müssen vor jeder Übertragung in das Zielprogramm durch die Radiologin oder den Radiologen geprüft werden.

Für eine einzelne selbstentpackende Datei `npm run dist:selfextract` verwenden. Diese Variante ist größer, enthält den Codex aber intern und benötigt keine nebenstehende `codex/`-Datei.
