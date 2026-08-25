const { app, BrowserWindow } = require("electron");

require("../src/main.js");

app.whenReady().then(() => {
  setTimeout(async () => {
    try {
      const windowRef = BrowserWindow.getAllWindows()[0];
      if (!windowRef) throw new Error("RadimoAgent did not create a BrowserWindow");
      const result = await windowRef.webContents.executeJavaScript(`({
        title: document.title,
        legacyMoons: document.querySelectorAll(".moon").length,
        workRadar: Boolean(document.querySelector(".work-radar")),
        contextMoon: Boolean(document.querySelector("#contextMoon")),
        status: document.querySelector("#statusText")?.textContent || null,
        model: document.querySelector("#modelSelect")?.value || null
      })`);
      console.log(JSON.stringify(result));
      app.quit();
    } catch (error) {
      console.error(error.stack || error.message);
      app.exit(1);
    }
  }, 8000);
});
