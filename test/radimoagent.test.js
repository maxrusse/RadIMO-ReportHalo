const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { findAdjacentContext, formatContextReport } = require("../src/context-finder");
const { resolveCodexBinary } = require("../src/platform");
const { buildTurnInstructions } = require("../src/medical-gate");
const {
  DEFAULT_PROFILE,
  formatGuidancePrompt,
  loadGuidanceProfile,
  normalizeProfile,
  parseGuidanceMarkdown,
  saveGuidanceProfile,
  serializeGuidanceMarkdown,
} = require("../src/report-writing-guidance");
const { loadTemplateLibrary } = require("../src/template-library");
const { readReferencePack, formatReferencePack, validateReferenceUrl, readReferenceUrl } = require("../src/reference-library");
const { proxyEndpointFromInternetSettings } = require("../src/windows-proxy");
const { applyCodexProxy, isOpenAiNoProxyEntry } = require("../src/codex-proxy-env");
const { CodexAppServer } = require("../src/codex-app-server");
const { fieldEnvironment } = require("../src/windows-field-bridge");
const { createWorkflowStore } = require("../src/workflow-state");
const { formatClinicSourcePrompt, clinicSummary, loadClinicSourceLibrary, readClinicSource, saveClinicRoot } = require("../src/clinic-source-library");

test("helper and desktop share a local case with named artifacts", () => {
  let sequence = 0;
  const store = createWorkflowStore({ idFactory: () => `case-${++sequence}`, clock: () => new Date("2026-08-25T10:00:00.000Z") });
  const first = store.startCase({ origin: "helper", fieldType: "beurteilung", fieldLabel: "Beurteilung / Zusammenfassung" });
  assert.equal(first.origin, "helper");
  assert.equal(first.fieldType, "beurteilung");
  const withArtifact = store.addArtifact({ kind: "helper-result", label: "Zusammenfassung", detail: "Nur als Entwurf", text: "Keine Fraktur nachweisbar.", source: "helper" });
  assert.equal(withArtifact.artifacts.length, 1);
  assert.equal(withArtifact.artifacts[0].text, "Keine Fraktur nachweisbar.");
  assert.equal(store.patch({ origin: "desktop", phase: "reviewing", target: "desktop" }).origin, "desktop");
  assert.equal(store.get().artifacts[0].label, "Zusammenfassung");
});

test("context beta collects two files up and one file down around Befund", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "radimoagent-context-"));
  try {
    const files = {
      "01_Fragestellung.txt": "Warum wurde die Untersuchung angefordert?",
      "02_Anforderung.txt": "CT Abdomen mit Kontrastmittel",
      "03_Befund.txt": "Befundtext",
      "04_Beurteilung.txt": "Beurteilungstext",
      "05_technisch.txt": "Technische Zusatzinformation",
    };
    for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(directory, name), content);
    const report = await findAdjacentContext(path.join(directory, "03_Befund.txt"));
    assert.deepEqual(report.items.map((item) => item.relation), ["2 up", "1 up", "selected", "1 down"]);
    assert.deepEqual(report.items.map((item) => item.section), ["Fragestellung", "Anforderung", "Befund", "Beurteilung"]);
    assert.equal(report.items.find((item) => item.relation === "selected").content, "Befundtext");
    assert.match(formatContextReport(report), /Requested report context/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("medical gate distinguishes guarded work from optional evidence mode", () => {
  const guarded = buildTurnInstructions({ medicalGate: true, evidenceMode: false });
  const evidence = buildTurnInstructions({ medicalGate: true, evidenceMode: true });
  assert.match(guarded, /MEDICAL \/ RADIOLOGY SAFETY GATE/);
  assert.match(guarded, /OPEN DISCUSSION MODE/);
  assert.doesNotMatch(guarded, /EVIDENCE MODE/);
  assert.match(evidence, /EVIDENCE MODE/);
  assert.match(evidence, /SOURCES USED/);
});

test("radiology work modes keep reasoning separate from language-only correction", () => {
  const differential = buildTurnInstructions({ assistantMode: "differential", radiologyMode: true });
  const correction = buildTurnInstructions({ assistantMode: "correction", radiologyMode: true });
  const conclusion = buildTurnInstructions({ assistantMode: "conclusion", radiologyMode: true });
  const summaryField = buildTurnInstructions({ assistantMode: "conclusion", radiologyMode: true, fieldType: "beurteilung", fieldLabel: "Beurteilung / Zusammenfassung" });
  assert.match(differential, /DIFFERENTIAL MODE/);
  assert.match(differential, /discriminating features/);
  assert.match(conclusion, /BEURTEILUNG MODE/);
  assert.match(correction, /LEKTORAT MODE/);
  assert.match(correction, /Do not add interpretation/);
  assert.match(summaryField, /WORKFIELD CONTRACT — BEURTEILUNG \/ ZUSAMMENFASSUNG/);
  assert.match(summaryField, /Do not include the full Befund/);
});

test("radiology reasoning prefers online peer-reviewed sources without adding a main-view toggle", () => {
  const instructions = buildTurnInstructions({ assistantMode: "differential", radiologyMode: true });
  assert.match(instructions, /ONLINE RADIOLOGY REVIEW/);
  assert.match(instructions, /peer-reviewed radiology literature/);
  assert.match(instructions, /PubMed/);
  const correction = buildTurnInstructions({ assistantMode: "correction", radiologyMode: true });
  assert.doesNotMatch(correction, /ONLINE RADIOLOGY REVIEW/);
});

test("German and Latin report guidance is explicit and conservative", () => {
  const profile = normalizeProfile({
    terminology: [{ preferred: "in situ", aliases: ["insitu"], note: "Preserve as approved Latin terminology." }],
    phrasePatterns: [{ label: "Uncertainty", phrase: "vereinbar mit", section: "Beurteilung" }],
    examples: [{ title: "Style only", input: "unauffällig", approved: "Unauffälliger Befund." }],
  });
  const prompt = formatGuidancePrompt(profile);
  assert.match(prompt, /REPORT WRITING PROFILE: German \/ Latin Befundtexte/);
  assert.match(prompt, /Preserve every measurement/);
  assert.match(prompt, /in situ/);
  assert.match(prompt, /vereinbar mit/);
  assert.match(prompt, /style references, not facts/);
  assert.match(buildTurnInstructions({ assistantMode: "correction", writingGuidance: prompt }), /REPORT WRITING PROFILE/);
});

test("department guidance profile can accumulate through a user-local override", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "radimoagent-guidance-"));
  try {
    const saved = await saveGuidanceProfile(directory, {
      ...DEFAULT_PROFILE,
      terminology: [{ preferred: "Beispielterminus", aliases: ["Alias"] }],
    });
    const loaded = await loadGuidanceProfile({ appRoot: path.join(__dirname, ".."), userDataPath: directory });
    assert.equal(loaded.source, "local");
    assert.equal(loaded.profile.terminology[0].preferred, "Beispielterminus");
    assert.equal(saved.profile.profileId, "german-radiology-befund");
    assert.match(await fs.readFile(saved.sourcePath, "utf8"), /## Department terminology/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("editable Markdown guidance round-trips terminology, phrases, and examples", () => {
  const markdown = serializeGuidanceMarkdown({
    label: "Team profile",
    styleRules: ["Preserve laterality."],
    terminology: [{ preferred: "in situ", aliases: ["insitu"], note: "Latin term" }],
    phrasePatterns: [{ label: "Conclusion", phrase: "vereinbar mit", section: "Beurteilung", note: "Review" }],
    examples: [{ title: "Example", input: "text alt", approved: "Text neu", note: "Style only" }],
  });
  const parsed = parseGuidanceMarkdown(markdown);
  assert.equal(parsed.terminology[0].preferred, "in situ");
  assert.equal(parsed.phrasePatterns[0].phrase, "vereinbar mit");
  assert.equal(parsed.examples[0].approved, "Text neu");
});

test("template library falls back to generic local-safe templates", async () => {
  const library = await loadTemplateLibrary({ appRoot: path.join(__dirname, ".."), executablePath: path.join(os.tmpdir(), "missing-radimoagent.exe"), resourcesPath: path.join(os.tmpdir(), "missing-resources"), userDataPath: path.join(os.tmpdir(), "missing-user-data") });
  assert.equal(library.source, "local");
  assert.ok(library.templates.some((template) => template.id === "generic-befund"));
});

test("attached screen images activate an explicit visual-review safety instruction", () => {
  const instructions = buildTurnInstructions({ assistantMode: "discussion", radiologyMode: true, imageAttached: true });
  assert.match(instructions, /IMAGE REVIEW MODE/);
  assert.match(instructions, /original DICOM\/PACS study/);
});

test("Codex turns use the supported localImage input shape", async () => {
  const client = new CodexAppServer();
  client.request = async (_method, params) => params;
  const turn = await client.sendTurn({ threadId: "thread-1", text: "Review the attached image.", imagePath: "/tmp/radimoagent-capture-test.png", assistantMode: "discussion", radiologyMode: true, fieldType: "beurteilung", fieldLabel: "Beurteilung" });
  assert.deepEqual(turn.input.at(-1), { type: "localImage", path: "/tmp/radimoagent-capture-test.png", detail: "high" });
  assert.match(turn.input[0].text, /WORKFIELD CONTRACT — BEURTEILUNG/);
});

test("radiology reasoning turns allow read-only online source review", async () => {
  const client = new CodexAppServer();
  client.request = async (_method, params) => params;
  const turn = await client.sendTurn({ threadId: "thread-2", text: "Prüfe die Differenzialdiagnose.", assistantMode: "differential", radiologyMode: true });
  assert.equal(turn.sandboxPolicy.networkAccess, true);
  const correction = await client.sendTurn({ threadId: "thread-3", text: "Korrigiere den Text.", assistantMode: "correction", radiologyMode: true });
  assert.equal(correction.sandboxPolicy.networkAccess, false);
});

test("local reference pack reads text and keeps PDFs trace-only", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "radimoagent-references-"));
  try {
    const htmlPath = path.join(directory, "radiopaedia-export.html");
    const pdfPath = path.join(directory, "peer-reviewed-paper.pdf");
    await fs.writeFile(htmlPath, "<html><body><h1>Acute appendicitis</h1><p>Wall thickening and periappendiceal fat stranding.</p></body></html>");
    await fs.writeFile(pdfPath, "%PDF-1.4 not parsed in local beta");
    const pack = await readReferencePack([htmlPath, pdfPath]);
    assert.equal(pack[0].status, "ready");
    assert.match(pack[0].content, /Acute appendicitis/);
    assert.equal(pack[1].status, "metadata-only");
    assert.equal(pack[1].content, "");
    assert.match(formatReferencePack(pack), /radiopaedia-export\.html/);
    assert.doesNotMatch(formatReferencePack(pack), /peer-reviewed-paper\.pdf/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("clinic PDF folders are reusable and register a source in the clinic AGENTS.md", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "radimoagent-clinics-"));
  try {
    const clinicRoot = path.join(directory, "clinics");
    const clinicDir = path.join(clinicRoot, "Demo-Klinik");
    const sourceDir = path.join(clinicDir, "sources");
    await fs.mkdir(sourceDir, { recursive: true });
    const pdfPath = path.join(sourceDir, "leitlinie.pdf");
    const secondPdfPath = path.join(sourceDir, "artikel.pdf");
    await fs.writeFile(pdfPath, "%PDF-1.4 placeholder");
    await fs.writeFile(secondPdfPath, "%PDF-1.4 second placeholder");
    await saveClinicRoot(directory, clinicRoot);
    const library = await loadClinicSourceLibrary({ appRoot: directory, userDataPath: directory, executablePath: path.join(directory, "RadimoAgent.exe"), resourcesPath: path.join(directory, "resources") });
    assert.equal(clinicSummary(library).clinics[0].sources[0].status, "new");
    const item = await readClinicSource(library, "demo-klinik", pdfPath);
    assert.equal(item.referenced, true);
    assert.equal(item.status, "metadata-only");
    assert.match(await fs.readFile(item.agentsPath, "utf8"), /leitlinie\.pdf/);
    assert.equal(formatClinicSourcePrompt(item), "");
    await readClinicSource(await loadClinicSourceLibrary({ appRoot: directory, userDataPath: directory, executablePath: path.join(directory, "RadimoAgent.exe"), resourcesPath: path.join(directory, "resources") }), "demo-klinik", secondPdfPath);
    const agents = await fs.readFile(item.agentsPath, "utf8");
    assert.match(agents, /leitlinie\.pdf/);
    assert.match(agents, /artikel\.pdf/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("medical URL references are HTTPS-only and restricted to approved sources", () => {
  assert.equal(validateReferenceUrl("https://pubmed.ncbi.nlm.nih.gov/12345/"), "https://pubmed.ncbi.nlm.nih.gov/12345/");
  assert.throws(() => validateReferenceUrl("http://pubmed.ncbi.nlm.nih.gov/12345/"), /HTTPS/);
  assert.throws(() => validateReferenceUrl("https://example.com/article"), /approved/);
});

test("approved medical URL references are fetched into a traceable local text item", async () => {
  const response = {
    ok: true,
    status: 200,
    headers: { get(name) { return name === "content-type" ? "text/html; charset=utf-8" : "0"; } },
    async text() { return "<html><head><title>Study</title></head><body><h1>Acute appendicitis</h1><p>Periappendiceal inflammatory change.</p></body></html>"; },
  };
  const item = await readReferenceUrl("https://pubmed.ncbi.nlm.nih.gov/12345/", async () => response);
  assert.equal(item.sourceType, "web");
  assert.equal(item.status, "ready");
  assert.equal(item.url, "https://pubmed.ncbi.nlm.nih.gov/12345/");
  assert.match(item.content, /Acute appendicitis/);
  assert.match(item.content, /Periappendiceal inflammatory change/);
});

test("Windows packaging resolves the Codex path beside a slim portable EXE", () => {
  assert.equal(resolveCodexBinary({ platform: "win32", env: { PORTABLE_EXECUTABLE_DIR: "C:\\RadimoAgent" }, resourcesPath: "C:\\RadimoAgent\\resources", filesystem: { existsSync: (value) => value === "C:\\RadimoAgent\\codex\\codex.exe" } }), "C:\\RadimoAgent\\codex\\codex.exe");
  assert.equal(resolveCodexBinary({ platform: "win32", env: {}, resourcesPath: "C:\\RadimoAgent\\resources" }), "C:\\RadimoAgent\\resources\\codex\\codex.exe");
});

test("Windows Internet Settings proxy prefers the HTTPS route without exposing credentials", () => {
  assert.equal(
    proxyEndpointFromInternetSettings({ enabled: true, server: "http=proxy.example:8080;https=secure.example:8443" }),
    "http://secure.example:8443",
  );
  assert.equal(proxyEndpointFromInternetSettings({ enabled: false, server: "proxy.example:8080" }), null);
});

test("Codex proxy environment removes OpenAI from inherited NO_PROXY but preserves local callbacks", () => {
  const environment = { NO_PROXY: "localhost,127.0.0.1,auth.openai.com,.openai.com" };
  const changed = applyCodexProxy(environment, "http://proxy.example:8080");
  assert.equal(changed, true);
  assert.equal(environment.HTTPS_PROXY, "http://proxy.example:8080");
  assert.equal(environment.no_proxy, "localhost,127.0.0.1");
  assert.equal(isOpenAiNoProxyEntry("*.openai.com"), true);
});

test("field lock transfer carries target identity for a safe Windows insertion check", () => {
  assert.deepEqual(fieldEnvironment({ windowHandle: 42, processId: 77, automationId: "report-field", controlType: "ControlType.Edit" }), {
    RADIMO_FIELD_WINDOW: "42",
    RADIMO_FIELD_PROCESS: "77",
    RADIMO_FIELD_AUTOMATION_ID: "report-field",
    RADIMO_FIELD_CONTROL_TYPE: "ControlType.Edit",
  });
});
