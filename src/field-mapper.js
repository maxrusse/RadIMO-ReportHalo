const DEFAULT_INCLUDE = [
  "clinical_question = *fragestellung* | *frage* | *anforderung*",
  "lab = *labor*",
  "contrast = *kontrast*",
  "report = *befund*",
  "summary = *beurteilung* | *impression*",
  "clinical_info = *klinische angabe* | *anamnese* | *indikation*",
  "referrer_notes = *zuweis* | *überweisung* | *einweiser* | *referenten*",
].join("\n");
const DEFAULT_EXCLUDE = ["*patient*", "*geburtsdatum*", "*geburt*", "*adresse*", "*telefon*", "*versicherung*", "*fallnummer*", "*patienten-id*", "*patientennummer*", "*versichertennummer*", "*patientenname*", "*patname*", "*nachname*", "*vorname*"].join("\n");
const $ = (id) => document.getElementById(id);

function setStatus(value, error = false) {
  const node = $("status");
  if (!node) return;
  node.textContent = value;
  node.style.color = error ? "var(--danger)" : "var(--accent)";
}

function fieldLabel(field) {
  const label = field?.label || field?.name || field?.labeledBy || field?.automationId || "Unnamed text field";
  return [label, field?.automationId, field?.controlType, field?.frameworkId].filter(Boolean).join(" · ");
}

function renderReport(report) {
  window.currentFieldMapperReport = report;
  if (!report?.ok) {
    $("source").textContent = "";
    $("groups").replaceChildren();
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = report?.error || "The window could not be inspected.";
    $("groups").append(message);
    $("allFields").replaceChildren();
    $("allFieldsSummary").textContent = "All detected text fields";
    setStatus(report?.error || "Scan failed.", true);
    return;
  }
  const diagnostics = report.diagnostics || {};
  $("source").textContent = `${report.source?.processName || "window"} · ${diagnostics.textFields || 0} text fields`;
  const groups = $("groups");
  groups.replaceChildren();
  const configured = report.configuredGroups || [];
  for (const configuredGroup of configured) {
    const group = report.groups?.find((item) => item.key === configuredGroup.key);
    const article = document.createElement("article");
    article.className = "group";
    const head = document.createElement("div");
    head.className = "group-head";
    const title = document.createElement("strong");
    title.textContent = configuredGroup.label;
    const count = document.createElement("small");
    count.textContent = group?.values?.length ? `${group.values.length} value${group.values.length === 1 ? "" : "s"}` : configuredGroup.fieldCount ? `${configuredGroup.fieldCount} field${configuredGroup.fieldCount === 1 ? "" : "s"} · empty` : "not found";
    head.append(title, count);
    article.append(head);
    for (const value of group?.values || []) {
      const valueNode = document.createElement("div");
      valueNode.className = "value";
      valueNode.textContent = value.length > 900 ? `${value.slice(0, 900)}…` : value;
      article.append(valueNode);
    }
    groups.append(article);
  }
  if (!configured.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No include rules configured.";
    groups.append(empty);
  }
  const allFields = $("allFields");
  allFields.replaceChildren();
  const fields = report.fields || [];
  $("allFieldsSummary").textContent = `All detected text fields (${fields.length})`;
  for (const field of fields) {
    const item = document.createElement("div");
    item.className = `field${field.excluded ? " is-excluded" : field.matches?.length ? " is-matched" : ""}`;
    const title = document.createElement("strong");
    title.textContent = fieldLabel(field);
    const note = document.createElement("small");
    const matches = field.matches?.map((match) => match.label || match.key).join(", ");
    note.textContent = field.excluded ? "excluded" : matches ? `mapped: ${matches}` : field.isPassword ? "protected field" : "unmapped · content not read";
    item.append(title, note);
    allFields.append(item);
  }
  const accessibilityNote = diagnostics.strategy === "uia-only" ? " · UIA-only" : "";
  const inaccessibleNote = diagnostics.inaccessibleFields ? ` · ${diagnostics.inaccessibleFields} not readable` : "";
  setStatus(`${diagnostics.readValues ? "Context read" : "Fields inspected"}: ${report.source?.processName || "window"} · ${diagnostics.matchedFields || 0} mapped · ${diagnostics.excludedFields || 0} excluded${inaccessibleNote}${diagnostics.truncated ? " · result capped" : ""}${accessibilityNote}.`);
}

async function loadProfile() {
  try {
    const profile = await window.reportHaloFieldMapper.getStatus();
    $("includeRules").value = profile?.includeText || DEFAULT_INCLUDE;
    $("excludeRules").value = profile?.excludeText || DEFAULT_EXCLUDE;
  } catch (error) {
    $("includeRules").value = DEFAULT_INCLUDE;
    $("excludeRules").value = DEFAULT_EXCLUDE;
    setStatus(error.message || "Profile unavailable.", true);
  }
}

async function saveProfile({ quiet = false } = {}) {
  const profile = await window.reportHaloFieldMapper.setConfig({ includeText: $("includeRules").value, excludeText: $("excludeRules").value });
  if (!quiet) setStatus("Mapping saved.");
  return profile;
}

async function scan(readValues) {
  try {
    await saveProfile({ quiet: true });
    setStatus(readValues ? "Reading configured UIA context…" : "Inspecting the stored/foreground UIA window…");
    const report = await window.reportHaloFieldMapper.scan({ readValues });
    renderReport(report);
    return report;
  } catch (error) {
    renderReport({ ok: false, error: error.message || "Scan failed." });
    return null;
  }
}

$("scanFields").addEventListener("click", () => { void scan(false); });
$("readContext").addEventListener("click", () => { void scan(true); });
$("saveProfile").addEventListener("click", () => { void saveProfile().catch((error) => setStatus(error.message || "Mapping could not be saved.", true)); });
$("resetProfile").addEventListener("click", () => { $("includeRules").value = DEFAULT_INCLUDE; $("excludeRules").value = DEFAULT_EXCLUDE; void saveProfile(); });
$("copyReport").addEventListener("click", async () => { const report = window.currentFieldMapperReport; if (!report?.reportText) return; try { await window.reportHaloFieldMapper.copy(report.reportText); setStatus("Report copied."); } catch (error) { setStatus(error.message || "Report could not be copied.", true); } });
$("saveReport").addEventListener("click", async () => { const report = window.currentFieldMapperReport; if (!report?.reportText) return; try { await window.reportHaloFieldMapper.saveReport(report.reportText); setStatus("Report saved."); } catch (error) { setStatus(error.message || "Report could not be saved.", true); } });
$("quit").addEventListener("click", () => { void window.reportHaloFieldMapper.quit(); });
window.reportHaloFieldMapper.onScanComplete((report) => { window.currentFieldMapperReport = report; renderReport(report); });
void loadProfile();
