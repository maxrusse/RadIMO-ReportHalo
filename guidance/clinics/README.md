# Klinikquellen

Klinikspezifische Quellen bleiben außerhalb der Hauptansicht und werden nur im Kontextbereich geöffnet.

Pro Klinik:

```text
clinics/
  <klinik-name>/
    AGENTS.md
    sources/
      leitlinie.pdf
      artikel.pdf
```

Die Anwendung listet PDFs aus `sources/`. Mit `Neu lesen` wird der Text lokal extrahiert, die Datei per SHA-256 registriert und ein Quellenabschnitt in der klinikspezifischen `AGENTS.md` gepflegt. Die gelesene PDF wird nur dann an die nächste Anfrage angehängt, wenn sie ausdrücklich mit `Anhängen` ausgewählt wurde.

`AGENTS.md` ist ein Quellenregister und keine Sammlung von Patienteninformationen. Nur geprüfte, nicht patientenbezogene und urheberrechtlich zulässige Unterlagen dort ablegen. Für medizinische Diskussionen bevorzugt RadimoAgent zusätzlich aktuelle peer-reviewte radiologische Literatur und Leitlinien, sofern Onlinezugriff verfügbar ist.
