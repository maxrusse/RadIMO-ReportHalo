# RadimoAgent für Windows

1. Diesen ZIP-Ordner vollständig entpacken.
2. `RadimoAgent.exe` starten.
3. Die Dateien unter `guidance/` dürfen angepasst werden. Besonders wichtig:
   - `german-radiology-profile.md` für Schreibstil, typische Begriffe und Formulierungen
   - `templates/*.md` für lokale Befundvorlagen
4. Nach Änderungen an Markdown-Dateien RadimoAgent neu starten.

Die Anwendung ist in dieser Entwicklungsfassung nicht signiert. Windows SmartScreen oder die Unternehmens-IT können deshalb eine Prüfung anzeigen.

Die lokale Webserver-Quelle für Vorlagen ist vorbereitet, aber derzeit deaktiviert. Ohne externe Vorlagen verwendet RadimoAgent die eingebauten generischen Vorlagen.

Die KI-Ausgaben bleiben Entwürfe. Befund und Beurteilung müssen vor jeder Übertragung in das Zielprogramm durch die Radiologin oder den Radiologen geprüft werden.
