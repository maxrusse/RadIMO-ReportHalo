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
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 8 }
function Root-Window([Int64]$value) {
  if ($value -le 0) { return 0 }
  $root = [RadimoUser32]::GetAncestor([IntPtr]::new($value), 2)
  if ($root -ne [IntPtr]::Zero) { return $root.ToInt64() }
  return $value
}
function Read-Focused {
  $selectionOnly = $env:RADIMO_FIELD_SELECTION_ONLY -eq 'true'
  $element = $null
  for ($attempt = 0; $attempt -lt 3 -and $null -eq $element; $attempt++) {
    try { $element = [System.Windows.Automation.AutomationElement]::FocusedElement } catch { $element = $null }
    if ($null -eq $element) { Start-Sleep -Milliseconds 45 }
  }
  if ($null -eq $element) { Emit @{ ok = $false; error = 'no-focused-element' }; return }
  try { $current = $element.Current } catch { Emit @{ ok = $false; error = 'focused-element-unavailable' }; return }
  $nativeWindow = [int64]$current.NativeWindowHandle
  $window = [RadimoUser32]::GetForegroundWindow().ToInt64()
  $windowSource = 'foreground'
  if ($nativeWindow -gt 0) {
    $window = Root-Window $nativeWindow
    $windowSource = 'native-control'
  } else {
    $window = Root-Window $window
  }
  $helperWindow = 0
  if ($env:RADIMO_HELPER_WINDOW) { [Int64]::TryParse($env:RADIMO_HELPER_WINDOW, [ref]$helperWindow) | Out-Null }
  if ($helperWindow -gt 0 -and $window -eq $helperWindow) { Emit @{ ok = $false; error = 'helper-focused'; windowHandle = $window; windowHandleSource = $windowSource }; return }
  $text = $null
  $strategy = $null
  $supportsWrite = $null
  $valuePattern = $null
  $hasValuePattern = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)
  if ($hasValuePattern) { $supportsWrite = -not $valuePattern.Current.IsReadOnly }
  if ($selectionOnly) {
    $textPattern = $null
    try {
      if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
        $selection = $textPattern.GetSelection()
        if ($selection -and $selection.Length -gt 0) {
          $text = (($selection | ForEach-Object { $_.GetText(-1) }) -join '')
          $strategy = 'TextPattern.Selection'
        }
      }
    } catch { $text = $null }
    if ([string]::IsNullOrWhiteSpace($text)) {
      Emit @{ ok = $false; error = 'no-selection'; strategy = 'TextPattern.Selection'; supportsWrite = $supportsWrite; replaceAll = $false; windowHandle = $window; windowHandleSource = $windowSource; controlWindowHandle = $nativeWindow; title = $current.Name; controlType = $current.ControlType.ProgrammaticName; automationId = $current.AutomationId; runtimeId = (($element.GetRuntimeId()) -join '.'); processId = $current.ProcessId }
      return
    }
  } elseif ($hasValuePattern) {
    $text = [string]$valuePattern.Current.Value
    $strategy = 'ValuePattern'
  } else {
    $textPattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
      $text = $textPattern.DocumentRange.GetText(-1)
      $strategy = 'TextPattern.DocumentRange'
    }
  }
  $runtimeId = ($element.GetRuntimeId() -join '.')
  $textBase64 = $(if ($null -eq $text) { $null } else { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)) })
  Emit @{ ok = ($null -ne $text); textBase64 = $textBase64; strategy = $strategy; supportsWrite = $supportsWrite; approximate = ($strategy -ne 'ValuePattern'); replaceAll = ($strategy -ne 'TextPattern.Selection'); windowHandle = $window; windowHandleSource = $windowSource; controlWindowHandle = $nativeWindow; title = $current.Name; controlType = $current.ControlType.ProgrammaticName; automationId = $current.AutomationId; runtimeId = $runtimeId; processId = $current.ProcessId }
}
function Write-Focused([string]$Text, [Int64]$WindowHandle) {
  if ($WindowHandle -le 0) { Emit @{ ok = $false; verified = $false; error = 'no-target-window' }; return }
  $handle = [IntPtr]::new($WindowHandle)
  if (-not [RadimoUser32]::SetForegroundWindow($handle)) { Emit @{ ok = $false; verified = $false; error = 'focus-rejected' }; return }
  Start-Sleep -Milliseconds 180
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $focused) { Emit @{ ok = $false; verified = $false; error = 'focus-not-confirmed' }; return }
  $current = $focused.Current
  $actualControlWindow = [int64]$current.NativeWindowHandle
  $actualWindow = if ($actualControlWindow -gt 0) { Root-Window $actualControlWindow } else { Root-Window ([RadimoUser32]::GetForegroundWindow().ToInt64()) }
  if ($actualWindow -ne $WindowHandle) { Emit @{ ok = $false; verified = $false; error = 'target-window-changed'; expectedWindow = $WindowHandle; actualWindow = $actualWindow }; return }
  $expectedProcess = 0
  if ($env:RADIMO_FIELD_PROCESS) { [int]::TryParse($env:RADIMO_FIELD_PROCESS, [ref]$expectedProcess) | Out-Null }
  if ($expectedProcess -gt 0 -and $current.ProcessId -ne $expectedProcess) { Emit @{ ok = $false; verified = $false; error = 'target-process-changed' }; return }
  if ($env:RADIMO_FIELD_AUTOMATION_ID -and $current.AutomationId -ne $env:RADIMO_FIELD_AUTOMATION_ID) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
  if ($env:RADIMO_FIELD_CONTROL_TYPE -and $current.ControlType.ProgrammaticName -ne $env:RADIMO_FIELD_CONTROL_TYPE) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
  if ($env:RADIMO_FIELD_RUNTIME_ID -and (($focused.GetRuntimeId() -join '.') -ne $env:RADIMO_FIELD_RUNTIME_ID)) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
  if (-not $env:RADIMO_FIELD_AUTOMATION_ID -and $env:RADIMO_FIELD_NAME -and $current.Name -ne $env:RADIMO_FIELD_NAME) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
  if ($env:RADIMO_FIELD_EXPECTED_HASH) {
    $before = $null
    if ($env:RADIMO_FIELD_SELECTION_ONLY -eq 'true') {
      $beforeSelectionPattern = $null
      try {
        if ($focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$beforeSelectionPattern)) {
          $beforeSelection = $beforeSelectionPattern.GetSelection()
          if ($beforeSelection -and $beforeSelection.Length -gt 0) { $before = (($beforeSelection | ForEach-Object { $_.GetText(-1) }) -join '') }
        }
      } catch { $before = $null }
      if ($null -eq $before) { Emit @{ ok = $false; verified = $false; error = 'target-selection-unavailable' }; return }
    } else {
      $beforeValuePattern = $null
      if ($focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$beforeValuePattern)) {
        $before = [string]$beforeValuePattern.Current.Value
      } else {
        $beforeTextPattern = $null
        if ($focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$beforeTextPattern)) { $before = $beforeTextPattern.DocumentRange.GetText(-1) }
      }
    }
    if ($null -eq $before) { Emit @{ ok = $false; verified = $false; error = 'target-text-unavailable' }; return }
    $beforeSha = [System.Security.Cryptography.SHA256]::Create()
    $beforeHash = [BitConverter]::ToString($beforeSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($before))).Replace('-', '').ToLowerInvariant()
    $beforeSha.Dispose()
    if ($beforeHash -ne $env:RADIMO_FIELD_EXPECTED_HASH) { Emit @{ ok = $false; verified = $false; error = 'target-text-changed' }; return }
  }
  $replaceAll = $env:RADIMO_FIELD_REPLACE_ALL -eq 'true'
  $append = $env:RADIMO_FIELD_APPEND -eq 'true'
  $usedStrategy = 'ClipboardPaste'
  $valuePattern = $null
  $canSetValue = $focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and -not $valuePattern.Current.IsReadOnly
  if ($replaceAll -and $canSetValue -and $env:RADIMO_FIELD_FORCE_CLIPBOARD -ne 'true') {
    $valuePattern.SetValue($Text)
    $usedStrategy = 'ValuePattern.SetValue'
  } else {
    if ($replaceAll) { [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 60 }
    if ($append) { [System.Windows.Forms.SendKeys]::SendWait('^{END}'); Start-Sleep -Milliseconds 60 }
    [System.Windows.Forms.SendKeys]::SendWait('^v')
  }
  Start-Sleep -Milliseconds 420
  $actual = $null
  $readPattern = $null
  if ($focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$readPattern)) {
    $actual = [string]$readPattern.Current.Value
  } else {
    $textPattern = $null
    if ($focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) { $actual = $textPattern.DocumentRange.GetText(-1) }
  }
  $verified = $false
  $actualHash = $null
  if ($null -ne $actual) {
    $verified = $(if ($replaceAll) { $actual -eq $Text } else { $actual.Contains($Text) })
    $actualSha = [System.Security.Cryptography.SHA256]::Create()
    $actualHash = [BitConverter]::ToString($actualSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($actual))).Replace('-', '').ToLowerInvariant()
    $actualSha.Dispose()
  }
  Emit @{ ok = $true; verified = $verified; strategy = $usedStrategy; readable = ($null -ne $actual); actualHash = $actualHash; error = $null }
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
      } catch (error) {
        resolve({
          ok: false,
          error: stderr.trim() || `powershell-exit-${code}`,
          processCode: code,
          parseError: error?.message || String(error),
          stdoutStart: stdout.trim().slice(0, 600),
          stdoutEnd: stdout.trim().slice(-600),
          stdoutLength: stdout.length,
        });
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
    RADIMO_FIELD_RUNTIME_ID: String(target?.runtimeId || ""),
    RADIMO_FIELD_NAME: String(target?.title || ""),
    RADIMO_FIELD_SELECTION_ONLY: target?.strategy === "TextPattern.Selection" ? "true" : "false",
    RADIMO_FIELD_EXPECTED_HASH: String(target?.expectedFieldHash || ""),
  };
}

async function readFocusedField({ selectionOnly = false, helperWindowHandle = "" } = {}) {
  const result = await runPowerShell({
    RADIMO_FIELD_SELECTION_ONLY: selectionOnly ? "true" : "false",
    RADIMO_HELPER_WINDOW: String(helperWindowHandle || ""),
  });
  if (typeof result.textBase64 === "string") {
    result.text = Buffer.from(result.textBase64, "base64").toString("utf8");
    delete result.textBase64;
  }
  if (typeof result.text === "string") result.hash = crypto.createHash("sha256").update(result.text, "utf8").digest("hex");
  return result;
}

async function writeFocusedField({ text, target } = {}) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, verified: false, error: "empty-text" };
  if (!target?.windowHandle) return { ok: false, verified: false, error: "no-target-window" };
  if (target.supportsWrite === false) return { ok: false, verified: false, error: "target-read-only" };
  if (text.length > 30000) return { ok: false, verified: false, error: "text-too-long" };
  return runPowerShell({
    ...fieldEnvironment(target),
    RADIMO_FIELD_ACTION: "write",
    RADIMO_FIELD_TEXT: text,
    RADIMO_FIELD_REPLACE_ALL: target.replaceAll ? "true" : "false",
    RADIMO_FIELD_APPEND: target.append ? "true" : "false",
    RADIMO_FIELD_FORCE_CLIPBOARD: target.forceClipboard ? "true" : "false",
  });
}

module.exports = { fieldEnvironment, readFocusedField, writeFocusedField };
