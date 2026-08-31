const path = require("node:path");
const { spawn } = require("node:child_process");
const electron = require("electron");

const child = spawn(electron, [path.resolve(__dirname, "..")], {
  env: { ...process.env, RADIMOAGENT_BACKEND: "api" },
  stdio: "inherit",
  windowsHide: false,
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
