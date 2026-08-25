const path = require("node:path");
const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-setuid-sandbox");

app.whenReady().then(async () => {
  const windowRef = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "renderer-smoke-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  windowRef.webContents.once("did-finish-load", async () => {
    try {
      const result = await windowRef.webContents.executeJavaScript(`(async () => {
        document.querySelector("#contextMoon").click();
        document.querySelector("#chooseContext").click();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
        title: document.title,
        language: document.documentElement.lang,
        germanHeading: document.querySelector(".island h1")?.textContent || null,
        legacyMoons: document.querySelectorAll(".moon").length,
        sideNavigation: Boolean(document.querySelector(".side-nav")),
        workRadar: Boolean(document.querySelector(".work-radar")),
        minimap: Boolean(document.querySelector("#minimap")),
        contextMoon: Boolean(document.querySelector("#contextMoon")),
        primarySourceControls: document.querySelector(".island")?.innerText.includes("Quellen") || false,
        clinicSourcesSecondary: Boolean(document.querySelector("#clinicSourceItems")),
        contextDrawerOpen: !document.querySelector("#contextDrawer").classList.contains("hidden"),
        contextAttachedEnabled: !document.querySelector("#useContext").disabled,
        contextCopyEnabled: !document.querySelector("#copyContext").disabled,
        selectedFieldCapture: document.querySelector("#selectedField").value === "Findings",
        medicalGate: document.querySelector("#medicalGate").checked,
        radiologyMode: document.querySelector("#radiologyMode").checked,
        localReferenceToggle: document.querySelector("#useLocalReferences")?.disabled === true,
        referencePanel: Boolean(document.querySelector("#referenceItems")),
        evidenceLedger: Boolean(document.querySelector("#evidenceLedger")),
        screenCapture: Boolean(document.querySelector("#captureScreen")),
        assistantMode: document.querySelector("#assistantMode")?.value || null,
        reportWorkMode: Boolean(document.querySelector("#assistantMode option[value='report']")),
        writingProfile: document.querySelector("#writingProfile")?.value || null,
        guidancePanel: Boolean(document.querySelector("#guidanceBadge")),
        templateLibrary: Boolean(document.querySelector("#templateSelect")),
        discussionButton: Boolean(document.querySelector("#newDiscussion")),
        artifactList: Boolean(document.querySelector("#artifactList")),
        composer: Boolean(document.querySelector("#composer")),
        model: document.querySelector("#modelSelect")?.value || null
        };
      })()`);
      console.log(JSON.stringify(result));
      windowRef.close();
      app.quit();
    } catch (error) {
      console.error(error.stack || error.message);
      app.exit(1);
    }
  });
  await windowRef.loadFile(path.join(__dirname, "..", "src", "renderer", "index.html"));
});
