const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
const ids = new Set([...html.matchAll(/\bid="([^\"]+)"/g)].map((match) => match[1]));
const references = [...app.matchAll(/\$\("([^\"]+)"\)/g)].map((match) => match[1]);
const missing = [...new Set(references)].filter((id) => !ids.has(id));
if (missing.length) {
  console.error(`Renderer references missing HTML ids: ${missing.join(", ")}`);
  process.exit(1);
}
const oldMoonCount = (html.match(/class="moon /g) || []).length;
const helperMoonCount = (html.match(/class="helper-moon /g) || []).length;
if (oldMoonCount || helperMoonCount) {
  console.error(`Legacy moon controls remain: desktop=${oldMoonCount}, helper=${helperMoonCount}`);
  process.exit(1);
}
for (const forbiddenText of ["Dein RIS bleibt offen.", "Arbeitsbegleiter für Befund und Fallfragen", "Offene Diskussion. Kein automatisches Schreiben ins RIS.", "Kurze Orientierung: Modus, Ziel, Artefakte"]) {
  if (html.includes(forbiddenText) || app.includes(forbiddenText)) {
    console.error(`Explanatory UI text remains: ${forbiddenText}`);
    process.exit(1);
  }
}
if (!html.match(/class="side-nav hidden"/)) {
  console.error("Legacy navigation must remain hidden in the minimal desktop shell.");
  process.exit(1);
}
for (const required of ["workspace-grid", "side-nav", "work-radar", "helper-view-switch", "helperVerticalMode", "helperMiniMode", "artifactList"]) {
  if (!html.includes(required)) {
    console.error(`Redesign contract missing: ${required}`);
    process.exit(1);
  }
}
if (css.includes("moonlets-sprite.png")) {
  console.error("Legacy moonlet sprite is still connected to the renderer stylesheet.");
  process.exit(1);
}
console.log(`UI contract ready: ${ids.size} ids, no legacy moon controls, helper view switch and work radar connected.`);
