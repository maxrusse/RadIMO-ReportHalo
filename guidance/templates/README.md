# Local report templates

Place editable Markdown templates in this folder or in `guidance/templates/` beside the portable executable.

Each template may start with simple frontmatter:

```md
---
id: ct-abdomen
label: CT Abdomen · local department template
mode: discussion
---

Fragestellung:

Befund:

Beurteilung:
```

The portable client checks the external executable folder first. A future local webserver is reserved but disabled. If no local templates are found, generic built-in templates are shown.
