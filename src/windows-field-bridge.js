const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const POWERSHELL = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RadimoUser32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
'@
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 8 }
function Read-Focused {
  $element = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $element) { Emit @{ ok = $false; error = 'no-focused-element' }; return }
  $window = [RadimoUser32]::GetForegroundWindow().ToInt64()
  $text = $null
  $strategy = $null
  $supportsWrite = $false
  $selectionOnly = $env:RADIMO_FIELD_SELECTION_ONLY -eq 'true'
  $valuePattern = $null
  if ($selectionOnly) {
    $textPattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
      $selection = $textPattern.GetSelection()
      if ($selection.Length -gt 0) {
        $text = (($selection | ForEach-Object { $_.GetText(-1) }) -join '')
        $strategy = 'TextPattern.Selection'
      }
    }
  }
  if ($null -eq $text -and $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
    $text = [string]$valuePattern.Current.Value
    $strategy = 'ValuePattern'
    $supportsWrite = $true
  }
  if ($null -eq $text) {
    $textPattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
      $text = $textPattern.DocumentRange.GetText(-1)
      $strategy = 'TextPattern.DocumentRange'
    }
  }
  $current = $element.Current
  Emit @{ ok = ($null -ne $text); text = $text; strategy = $strategy; supportsWrite = $supportsWrite; approximate = ($strategy -ne 'ValuePattern'); replaceAll = ($strategy -ne 'TextPattern.Selection'); windowHandle = $window; title = $current.Name; controlType = $current.ControlType.ProgrammaticName; automationId = $current.AutomationId; processId = $current.ProcessId }
}
function Write-Focused([string]$Text, [Int64]$WindowHandle) {
  if ($WindowHandle -le 0) { Emit @{ ok = $false; verified = $false; error = 'no-target-window' }; return }
  $handle = [IntPtr]::new($WindowHandle)
  if (-not [RadimoUser32]::SetForegroundWindow($handle)) { Emit @{ ok = $false; verified = $false; error = 'focus-rejected' }; return }
  Start-Sleep -Milliseconds 180
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $focused) { Emit @{ ok = $false; verified = $false; error = 'focus-not-confirmed' }; return }
  $current = $focused.Current
  $expectedProcess = 0
  if ($env:RADIMO_FIELD_PROCESS) { [int]::TryParse($env:RADIMO_FIELD_PROCESS, [ref]$expectedProcess) | Out-Null }
  if ($expectedProcess -gt 0 -and $current.ProcessId -ne $expectedProcess) { Emit @{ ok = $false; verified = $false; error = 'target-process-changed' }; return }
  if ($env:RADIMO_FIELD_AUTOMATION_ID -and $current.AutomationId -ne $env:RADIMO_FIELD_AUTOMATION_ID) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
  if ($env:RADIMO_FIELD_CONTROL_TYPE -and $current.ControlType.ProgrammaticName -ne $env:RADIMO_FIELD_CONTROL_TYPE) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
  if ($env:RADIMO_FIELD_REPLACE_ALL -eq 'true') { [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 60 }
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 420
  Emit @{ ok = $true; verified = $false; error = $null }
}
if ($env:RADIMO_FIELD_ACTION -eq 'write') { Write-Focused $env:RADIMO_FIELD_TEXT ([Int64]$env:RADIMO_FIELD_WINDOW) } else { Read-Focused }
`;

function runPowerShell(environment = {}) {
  if (process.platform !== "win32") return Promise.resolve({ ok: false, error: "windows-only" });
  const encoded = Buffer.from(POWERSHELL, "utf16le").toString("base64");
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolve({ ok: false, error: error.message }));
    child.on("close", (code) => {
      try {
        const result = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}");
        resolve({ ...result, processCode: code, stderr: stderr.trim().slice(0, 1000) });
      } catch {
        resolve({ ok: false, error: stderr.trim() || `powershell-exit-${code}` });
      }
    });
  });
}

function fieldEnvironment(target) {
  return {
    RADIMO_FIELD_WINDOW: String(target?.windowHandle || ""),
    RADIMO_FIELD_PROCESS: String(target?.processId || ""),
    RADIMO_FIELD_AUTOMATION_ID: String(target?.automationId || ""),
    RADIMO_FIELD_CONTROL_TYPE: String(target?.controlType || ""),
  };
}

async function readFocusedField({ selectionOnly = false } = {}) {
  const result = await runPowerShell({ RADIMO_FIELD_SELECTION_ONLY: selectionOnly ? "true" : "false" });
  if (typeof result.text === "string") result.hash = crypto.createHash("sha256").update(result.text, "utf8").digest("hex");
  return result;
}

async function writeFocusedField({ text, target } = {}) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, verified: false, error: "empty-text" };
  if (!target?.windowHandle) return { ok: false, verified: false, error: "no-target-window" };
  if (text.length > 30000) return { ok: false, verified: false, error: "text-too-long" };
  return runPowerShell({
    ...fieldEnvironment(target),
    RADIMO_FIELD_ACTION: "write",
    RADIMO_FIELD_TEXT: text,
    RADIMO_FIELD_REPLACE_ALL: target.replaceAll ? "true" : "false",
  });
}

module.exports = { fieldEnvironment, readFocusedField, writeFocusedField };
