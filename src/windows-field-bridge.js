const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { normalizeFieldMapperProfile } = require("./windows-field-mapper");

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
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, System.Text.StringBuilder lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern IntPtr GetFocus();
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
}
'@
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 8 }
function Root-Window([Int64]$value) {
  if ($value -le 0) { return 0 }
  $root = [RadimoUser32]::GetAncestor([IntPtr]::new($value), 2)
  if ($root -ne [IntPtr]::Zero) { return $root.ToInt64() }
  return $value
}
function Read-NativeWindowText([IntPtr]$handle, [int]$maxChars = 30000) {
  if ($handle -eq [IntPtr]::Zero) { return $null }
  $capacity = [Math]::Max(256, [Math]::Min(30000, $maxChars + 1))
  $buffer = New-Object System.Text.StringBuilder $capacity
  try { [RadimoUser32]::GetWindowText($handle, $buffer, $buffer.Capacity) | Out-Null } catch { return $null }
  $text = $buffer.ToString()
  if ([string]::IsNullOrEmpty($text)) {
    try {
      $length = [RadimoUser32]::GetWindowTextLength($handle)
      if ($length -gt 0) {
        $buffer = New-Object System.Text.StringBuilder ([Math]::Max(256, [Math]::Min(30000, $length + 2)))
        [RadimoUser32]::SendMessage($handle, 0x000D, [IntPtr]::new($buffer.Capacity), $buffer) | Out-Null
        $text = $buffer.ToString()
      }
    } catch { $text = '' }
  }
  if ($null -eq $text) { return $null }
  $text = $text.Trim()
  if ($text.Length -gt $maxChars) { return $text.Substring(0, $maxChars) }
  return $text
}
function Read-NativeFocusedHandle([Int64]$windowHandle) {
  if ($windowHandle -le 0) { return 0 }
  $targetProcess = 0
  try { $targetThread = [RadimoUser32]::GetWindowThreadProcessId([IntPtr]::new($windowHandle), [ref]$targetProcess) } catch { return 0 }
  if ($targetThread -eq 0 -or $targetProcess -eq 0) { return 0 }
  $currentThread = [RadimoUser32]::GetCurrentThreadId()
  $attached = $false
  try {
    if ($currentThread -ne $targetThread) { $attached = [RadimoUser32]::AttachThreadInput($currentThread, $targetThread, $true) }
    [RadimoUser32]::BringWindowToTop([IntPtr]::new($windowHandle)) | Out-Null
    return [RadimoUser32]::GetFocus().ToInt64()
  } catch { return 0 }
  finally { if ($attached) { [RadimoUser32]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null } }
}
function Set-NativeFocusedHandle([Int64]$windowHandle, [Int64]$controlHandle) {
  if ($windowHandle -le 0 -or $controlHandle -le 0) { return 0 }
  $targetHandle = [IntPtr]::new($controlHandle)
  $targetProcess = 0
  try { $targetThread = [RadimoUser32]::GetWindowThreadProcessId($targetHandle, [ref]$targetProcess) } catch { return 0 }
  if ($targetThread -eq 0 -or $targetProcess -eq 0) { return 0 }
  $currentThread = [RadimoUser32]::GetCurrentThreadId()
  $attached = $false
  try {
    if ($currentThread -ne $targetThread) { $attached = [RadimoUser32]::AttachThreadInput($currentThread, $targetThread, $true) }
    [RadimoUser32]::BringWindowToTop([IntPtr]::new($windowHandle)) | Out-Null
    [RadimoUser32]::SetForegroundWindow([IntPtr]::new($windowHandle)) | Out-Null
    [RadimoUser32]::SetActiveWindow([IntPtr]::new($windowHandle)) | Out-Null
    [RadimoUser32]::SetFocus($targetHandle) | Out-Null
    return [RadimoUser32]::GetFocus().ToInt64()
  } catch { return 0 }
  finally { if ($attached) { [RadimoUser32]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null } }
}
function Read-Focused {
  $selectionOnly = $env:RADIMO_FIELD_SELECTION_ONLY -eq 'true'
  $expectedWindow = 0
  if ($env:RADIMO_FIELD_EXPECTED_WINDOW) { [Int64]::TryParse($env:RADIMO_FIELD_EXPECTED_WINDOW, [ref]$expectedWindow) | Out-Null }
  $expectedProcess = 0
  if ($env:RADIMO_FIELD_EXPECTED_PROCESS) { [int]::TryParse($env:RADIMO_FIELD_EXPECTED_PROCESS, [ref]$expectedProcess) | Out-Null }
  $requestedControl = 0
  if ($env:RADIMO_FIELD_CONTROL_WINDOW) { [Int64]::TryParse($env:RADIMO_FIELD_CONTROL_WINDOW, [ref]$requestedControl) | Out-Null }
  $element = $null
  if ($requestedControl -gt 0) {
    $focusWindow = if ($expectedWindow -gt 0) { Root-Window $expectedWindow } else { Root-Window ([RadimoUser32]::GetForegroundWindow().ToInt64()) }
    $focusedNative = Read-NativeFocusedHandle $focusWindow
    if ($focusedNative -ne $requestedControl) { Emit @{ ok = $false; error = 'target-control-changed'; focusedWindowHandle = $focusedNative }; return }
    try { $element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($requestedControl)) } catch { $element = $null }
    if ($null -eq $element) { Emit @{ ok = $false; error = 'target-control-unavailable' }; return }
  } else {
    for ($attempt = 0; $attempt -lt 3 -and $null -eq $element; $attempt++) {
      try { $element = [System.Windows.Automation.AutomationElement]::FocusedElement } catch { $element = $null }
      if ($null -eq $element) { Start-Sleep -Milliseconds 45 }
    }
  }
  if ($null -eq $element) { Emit @{ ok = $false; error = 'no-focused-element' }; return }
  try { $current = $element.Current } catch { Emit @{ ok = $false; error = 'focused-element-unavailable' }; return }
  $observedControlWindow = if ($requestedControl -gt 0) { $requestedControl } else { [int64]$current.NativeWindowHandle }
  $observedWindow = if ($observedControlWindow -gt 0) { Root-Window $observedControlWindow } else { Root-Window ([RadimoUser32]::GetForegroundWindow().ToInt64()) }
  if ($expectedWindow -gt 0 -and $observedWindow -ne $expectedWindow) { Emit @{ ok = $false; error = 'target-window-changed'; expectedWindow = $expectedWindow; actualWindow = $observedWindow }; return }
  if ($expectedProcess -gt 0 -and $current.ProcessId -ne $expectedProcess) { Emit @{ ok = $false; error = 'target-process-changed' }; return }
  $nativeWindow = $observedControlWindow
  if ($requestedControl -gt 0) { $nativeWindow = $requestedControl }
  $window = $observedWindow
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
  if ($requestedControl -gt 0) {
    $focusedNative = Read-NativeFocusedHandle $window
    if ($focusedNative -ne $requestedControl) { Emit @{ ok = $false; error = 'target-control-changed'; focusedWindowHandle = $focusedNative }; return }
  }
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
  if (($null -eq $text -or [string]::IsNullOrEmpty([string]$text)) -and $nativeWindow -gt 0) {
    $text = Read-NativeWindowText ([IntPtr]::new($nativeWindow))
    if ($null -ne $text) {
      $strategy = 'NativeWindowText'
      if ($null -eq $supportsWrite) { $supportsWrite = $true }
    }
  }
  $runtimeId = ($element.GetRuntimeId() -join '.')
  $textBase64 = $(if ($null -eq $text) { $null } else { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)) })
  Emit @{ ok = ($null -ne $text); textBase64 = $textBase64; strategy = $strategy; supportsWrite = $supportsWrite; approximate = ($strategy -ne 'ValuePattern'); replaceAll = ($strategy -ne 'TextPattern.Selection'); windowHandle = $window; windowHandleSource = $windowSource; controlWindowHandle = $nativeWindow; title = $current.Name; controlType = $current.ControlType.ProgrammaticName; automationId = $current.AutomationId; runtimeId = $runtimeId; processId = $current.ProcessId }
}
function Write-Focused([string]$Text, [Int64]$WindowHandle) {
  if ($WindowHandle -le 0) { Emit @{ ok = $false; verified = $false; error = 'no-target-window' }; return }
  $handle = [IntPtr]::new($WindowHandle)
  $requestedControl = 0
  if ($env:RADIMO_FIELD_CONTROL_WINDOW) { [Int64]::TryParse($env:RADIMO_FIELD_CONTROL_WINDOW, [ref]$requestedControl) | Out-Null }
  $insertAtCursor = $env:RADIMO_FIELD_INSERT_AT_CURSOR -eq 'true'
  $foregroundSet = [RadimoUser32]::SetForegroundWindow($handle)
  if (-not $foregroundSet -and $requestedControl -le 0) { Emit @{ ok = $false; verified = $false; error = 'focus-rejected' }; return }
  Start-Sleep -Milliseconds 180
  if ($requestedControl -gt 0) {
    $restoredFocus = Set-NativeFocusedHandle $WindowHandle $requestedControl
    if ($restoredFocus -ne $requestedControl) { Emit @{ ok = $false; verified = $false; error = 'target-control-focus-not-confirmed' }; return }
    Start-Sleep -Milliseconds 80
    try { $focused = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($requestedControl)) } catch { $focused = $null }
  } else {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  }
  if ($null -eq $focused) { Emit @{ ok = $false; verified = $false; error = 'focus-not-confirmed' }; return }
  $current = $focused.Current
  $actualControlWindow = [int64]$current.NativeWindowHandle
  if ($requestedControl -gt 0) {
    $actualControlWindow = $requestedControl
  }
  $actualWindow = if ($actualControlWindow -gt 0) { Root-Window $actualControlWindow } else { Root-Window ([RadimoUser32]::GetForegroundWindow().ToInt64()) }
  if ($actualWindow -ne $WindowHandle) { Emit @{ ok = $false; verified = $false; error = 'target-window-changed'; expectedWindow = $WindowHandle; actualWindow = $actualWindow }; return }
  $expectedProcess = 0
  if ($env:RADIMO_FIELD_PROCESS) { [int]::TryParse($env:RADIMO_FIELD_PROCESS, [ref]$expectedProcess) | Out-Null }
  if ($expectedProcess -gt 0 -and $current.ProcessId -ne $expectedProcess) { Emit @{ ok = $false; verified = $false; error = 'target-process-changed' }; return }
  $nativeMappedTarget = $env:RADIMO_FIELD_RUNTIME_ID -like 'native.*'
  if (-not $nativeMappedTarget -and $env:RADIMO_FIELD_AUTOMATION_ID -and $current.AutomationId -ne $env:RADIMO_FIELD_AUTOMATION_ID) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
  if (-not $nativeMappedTarget -and $env:RADIMO_FIELD_CONTROL_TYPE -and $current.ControlType.ProgrammaticName -ne $env:RADIMO_FIELD_CONTROL_TYPE) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
  if (-not $nativeMappedTarget -and $env:RADIMO_FIELD_RUNTIME_ID -and (($focused.GetRuntimeId() -join '.') -ne $env:RADIMO_FIELD_RUNTIME_ID)) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
  if (-not $nativeMappedTarget -and -not $env:RADIMO_FIELD_AUTOMATION_ID -and $env:RADIMO_FIELD_NAME -and $current.Name -ne $env:RADIMO_FIELD_NAME) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed' }; return }
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
      if (($null -eq $before -or [string]::IsNullOrEmpty([string]$before)) -and $actualControlWindow -gt 0) { $before = Read-NativeWindowText ([IntPtr]::new($actualControlWindow)) }
    }
    if ($null -eq $before) { Emit @{ ok = $false; verified = $false; error = 'target-text-unavailable' }; return }
    $beforeSha = [System.Security.Cryptography.SHA256]::Create()
    $beforeHash = [BitConverter]::ToString($beforeSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($before))).Replace('-', '').ToLowerInvariant()
    $beforeSha.Dispose()
    if ($beforeHash -ne $env:RADIMO_FIELD_EXPECTED_HASH) { Emit @{ ok = $false; verified = $false; error = 'target-text-changed' }; return }
  }
  $replaceAll = $env:RADIMO_FIELD_REPLACE_ALL -eq 'true'
  $append = $env:RADIMO_FIELD_APPEND -eq 'true'
  if ($insertAtCursor) { $replaceAll = $false; $append = $false }
  $usedStrategy = 'ClipboardPaste'
  $valuePattern = $null
  $canSetValue = $focused.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and -not $valuePattern.Current.IsReadOnly
  if ($replaceAll -and $canSetValue -and $env:RADIMO_FIELD_FORCE_CLIPBOARD -ne 'true') {
    $valuePattern.SetValue($Text)
    $usedStrategy = 'ValuePattern.SetValue'
  } else {
    if ($requestedControl -gt 0) {
      if ($replaceAll) { [RadimoUser32]::SendMessage([IntPtr]::new($requestedControl), 0x00B1, [IntPtr]::Zero, [IntPtr]::new(-1)) | Out-Null }
      if ($append) { [RadimoUser32]::SendMessage([IntPtr]::new($requestedControl), 0x00B1, [IntPtr]::new(-1), [IntPtr]::new(-1)) | Out-Null }
      [RadimoUser32]::SendMessage([IntPtr]::new($requestedControl), 0x0302, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
      $usedStrategy = 'NativeControl.Paste'
    } else {
      if ($replaceAll) { [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 60 }
      if ($append) { [System.Windows.Forms.SendKeys]::SendWait('^{END}'); Start-Sleep -Milliseconds 60 }
      [System.Windows.Forms.SendKeys]::SendWait('^v')
    }
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
  if (($null -eq $actual -or [string]::IsNullOrEmpty([string]$actual)) -and $actualControlWindow -gt 0) { $actual = Read-NativeWindowText ([IntPtr]::new($actualControlWindow)) }
  $verified = $false
  $actualHash = $null
  if ($null -ne $actual) {
    $verified = $(if ($replaceAll) { $actual -eq $Text } else { $actual.Contains($Text) })
    $actualSha = [System.Security.Cryptography.SHA256]::Create()
    $actualHash = [BitConverter]::ToString($actualSha.ComputeHash([Text.Encoding]::UTF8.GetBytes($actual))).Replace('-', '').ToLowerInvariant()
    $actualSha.Dispose()
  }
  $actualTextBase64 = $(if ($null -eq $actual) { $null } else { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$actual)) })
  Emit @{ ok = $true; verified = $verified; strategy = $usedStrategy; readable = ($null -ne $actual); actualHash = $actualHash; actualTextBase64 = $actualTextBase64; error = $null }
}
if ($env:RADIMO_FIELD_ACTION -eq 'write') { Write-Focused $env:RADIMO_FIELD_TEXT ([Int64]$env:RADIMO_FIELD_WINDOW) } else { Read-Focused }
`;

const FIELD_SCAN_POWERSHELL = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class RadimoFieldMapperUser32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, System.Text.StringBuilder lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
}
'@
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 10 }
function Root-Window([Int64]$value) {
  if ($value -le 0) { return 0 }
  $root = [RadimoFieldMapperUser32]::GetAncestor([IntPtr]::new($value), 2)
  if ($root -ne [IntPtr]::Zero) { return $root.ToInt64() }
  return $value
}
function Clean([object]$value, [int]$maxChars = 240) {
  if ($null -eq $value) { return '' }
  return ([string]$value).Trim().Substring(0, [Math]::Min(([string]$value).Trim().Length, $maxChars))
}
function Matches-Pattern([string]$value, [object]$patterns) {
  if ([string]::IsNullOrWhiteSpace($value)) { return $false }
  foreach ($pattern in @($patterns)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$pattern) -and $value -like [string]$pattern) { return $true }
  }
  return $false
}
function Read-ElementText($element, [int]$maxChars) {
  $valuePattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
    $text = [string]$valuePattern.Current.Value
    if ($text.Length -gt $maxChars) { return $text.Substring(0, $maxChars) }
    return $text
  }
  $textPattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
    $text = [string]$textPattern.DocumentRange.GetText($maxChars)
    if ($text.Length -gt $maxChars) { return $text.Substring(0, $maxChars) }
    return $text
  }
  return $null
}
function Native-Text([IntPtr]$handle, [int]$maxChars) {
  $capacity = [Math]::Max(256, [Math]::Min(20000, $maxChars + 1))
  $buffer = New-Object System.Text.StringBuilder $capacity
  try { [RadimoFieldMapperUser32]::GetWindowText($handle, $buffer, $buffer.Capacity) | Out-Null } catch { return $null }
  $text = $buffer.ToString()
  if ([string]::IsNullOrEmpty($text)) {
    try {
      $length = [RadimoFieldMapperUser32]::GetWindowTextLength($handle)
      if ($length -gt 0) {
        $buffer = New-Object System.Text.StringBuilder ([Math]::Max(256, [Math]::Min(20000, $length + 2)))
        [RadimoFieldMapperUser32]::SendMessage($handle, 0x000D, [IntPtr]::new($buffer.Capacity), $buffer) | Out-Null
        $text = $buffer.ToString()
      }
    } catch { $text = '' }
  }
  if ($null -eq $text) { return $null }
  $text = $text.Trim()
  if ($text.Length -gt $maxChars) { return $text.Substring(0, $maxChars) }
  return $text
}
function Native-Class([IntPtr]$handle) {
  $buffer = New-Object System.Text.StringBuilder 260
  try { [RadimoFieldMapperUser32]::GetClassName($handle, $buffer, $buffer.Capacity) | Out-Null } catch { return '' }
  return Clean $buffer.ToString() 180
}
function Native-Records([Int64]$windowHandle) {
  $records = New-Object 'System.Collections.Generic.List[object]'
  $stack = New-Object 'System.Collections.Generic.List[object]'
  [void]$stack.Add([ordered]@{ handle = [IntPtr]::new($windowHandle); parent = [IntPtr]::Zero })
  while ($stack.Count -gt 0) {
    $item = $stack[$stack.Count - 1]
    $stack.RemoveAt($stack.Count - 1)
    $child = [RadimoFieldMapperUser32]::GetWindow([IntPtr]$item.handle, [UInt32]5)
    $order = 0
    while ($child -ne [IntPtr]::Zero) {
      $record = [ordered]@{
        handle = $child
        parent = $item.handle
        order = $order
        className = Native-Class $child
        text = Native-Text $child 20000
      }
      [void]$records.Add($record)
      [void]$stack.Add([ordered]@{ handle = $child; parent = $child })
      $child = [RadimoFieldMapperUser32]::GetWindow([IntPtr]$child, [UInt32]2)
      $order++
    }
  }
  return $records.ToArray()
}
function Is-NativeTextClass([string]$className) {
  return $className -match '(?i)(^|[.:])edit($|[.:])|richedit|textbox|memo|textedit|tedit'
}
function Scan-Window {
  $started = [Diagnostics.Stopwatch]::StartNew()
  $config = $null
  try {
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:RADIMO_FIELD_MAPPER_CONFIG_B64))
    $config = $json | ConvertFrom-Json
  } catch {
    Emit @{ ok = $false; error = 'invalid-field-mapper-config' }
    return
  }
  $requested = 0
  if ($env:RADIMO_FIELD_SCAN_WINDOW) { [Int64]::TryParse($env:RADIMO_FIELD_SCAN_WINDOW, [ref]$requested) | Out-Null }
  $foreground = [RadimoFieldMapperUser32]::GetForegroundWindow().ToInt64()
  $window = Root-Window $(if ($requested -gt 0) { $requested } else { $foreground })
  $helperWindow = 0
  if ($env:RADIMO_HELPER_WINDOW) { [Int64]::TryParse($env:RADIMO_HELPER_WINDOW, [ref]$helperWindow) | Out-Null }
  if ($window -le 0) { Emit @{ ok = $false; error = 'no-target-window' }; return }
  if ($helperWindow -gt 0 -and $window -eq $helperWindow) { Emit @{ ok = $false; error = 'helper-window'; windowHandle = $window }; return }
  $root = $null
  try { $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($window)) } catch { $root = $null }
  if ($null -eq $root) { Emit @{ ok = $false; error = 'window-not-accessible'; windowHandle = $window }; return }
  try { $rootCurrent = $root.Current } catch { Emit @{ ok = $false; error = 'window-properties-unavailable'; windowHandle = $window }; return }
  $elements = $null
  try { $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) } catch { Emit @{ ok = $false; error = 'automation-tree-unavailable'; windowHandle = $window }; return }
  $maxFields = [Math]::Max(20, [Math]::Min(250, [int]$config.limits.maxFields))
  $maxValueChars = [Math]::Max(256, [Math]::Min(20000, [int]$config.limits.maxValueChars))
  $readValues = $env:RADIMO_FIELD_READ_VALUES -eq 'true'
  $fields = @()
  $processed = 0
  $textFields = 0
  $inaccessible = 0
  $truncated = $false
  $seenNativeHandles = New-Object 'System.Collections.Generic.HashSet[string]'
  $nativeError = ''
  foreach ($element in @($elements)) {
    $processed++
    if ($fields.Count -ge $maxFields) { $truncated = $true; break }
    $current = $null
    try { $current = $element.Current } catch { $inaccessible++; continue }
    $valuePattern = $null
    $textPattern = $null
    $hasValue = $false
    $hasText = $false
    try { $hasValue = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) } catch { $hasValue = $false }
    try { $hasText = $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern) } catch { $hasText = $false }
    if (-not $hasValue -and -not $hasText) { continue }
    $textFields++
    $labeledByName = ''
    try {
      $labeledBy = $current.LabeledBy
      if ($null -ne $labeledBy) { $labeledByName = Clean $labeledBy.Current.Name 240 }
    } catch { $labeledByName = '' }
    $name = Clean $current.Name 240
    $automationId = Clean $current.AutomationId 180
    $helpText = Clean $current.HelpText 240
    $className = Clean $current.ClassName 180
    $identities = @($labeledByName, $name, $automationId, $helpText, $className) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
    $isPassword = $false
    try { $isPassword = [bool]$current.IsPassword } catch { $isPassword = $false }
    $excluded = $isPassword
    if (-not $excluded) {
      foreach ($identity in $identities) {
        if (Matches-Pattern $identity $config.exclude) { $excluded = $true; break }
      }
    }
    $matches = @()
    if (-not $excluded) {
      foreach ($rule in @($config.include)) {
        $ruleMatched = $false
        foreach ($identity in $identities) {
          if (Matches-Pattern $identity $rule.patterns) { $ruleMatched = $true; break }
        }
        if ($ruleMatched) {
          $matches += [ordered]@{ key = Clean $rule.key 80; label = Clean $rule.label 120; maxChars = [Math]::Max(256, [Math]::Min($maxValueChars, [int]$rule.maxChars)) }
        }
      }
    }
    $value = $null
    if ($readValues -and -not $excluded -and $matches.Count -gt 0 -and -not $isPassword) {
      try { $value = Read-ElementText $element $maxValueChars } catch { $value = $null; $inaccessible++ }
    }
    $valueBase64 = $null
    if ($null -ne $value) { $valueBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$value)) }
    $nativeHandleValue = [int64]$current.NativeWindowHandle
    if ($nativeHandleValue -gt 0) { [void]$seenNativeHandles.Add([string]$nativeHandleValue) }
    $isReadOnly = $null
    if ($hasValue) { try { $isReadOnly = [bool]$valuePattern.Current.IsReadOnly } catch { $isReadOnly = $null } }
    $runtimeId = ''
    try { $runtimeId = ($element.GetRuntimeId() -join '.') } catch { $runtimeId = '' }
    $fields += [ordered]@{
      name = $name
      label = $(if ($labeledByName) { $labeledByName } elseif ($name) { $name } elseif ($automationId) { $automationId } else { 'Unbenanntes Textfeld' })
      automationId = $automationId
      helpText = $helpText
      labeledBy = $labeledByName
      className = $className
      frameworkId = Clean $current.FrameworkId 80
      controlType = Clean $current.ControlType.ProgrammaticName 120
      processId = [int]$current.ProcessId
       nativeWindowHandle = $nativeHandleValue
      runtimeId = $runtimeId
      isEnabled = [bool]$current.IsEnabled
      isOffscreen = [bool]$current.IsOffscreen
      isPassword = $isPassword
      isReadOnly = $isReadOnly
      supportsValue = [bool]$hasValue
      supportsText = [bool]$hasText
      identities = @($identities)
      excluded = $excluded
      matches = @($matches)
      valueBase64 = $valueBase64
      valueChars = $(if ($null -eq $value) { 0 } else { ([string]$value).Length })
    }
  }
  try {
    $nativeRecords = Native-Records $window
    $lastLabelByParent = @{}
    foreach ($record in @($nativeRecords | Sort-Object { [string]$_.parent }, order)) {
      $className = [string]$record.className
      $recordText = [string]$record.text
      $isLabelClass = $className -match '(?i)static|label|caption'
      if ($isLabelClass -and -not [string]::IsNullOrWhiteSpace($recordText)) {
        $lastLabelByParent[[string]$record.parent] = Clean $recordText 240
        continue
      }
      if (-not (Is-NativeTextClass $className)) { continue }
      $nativeHandleValue = $record.handle.ToInt64()
      if ($seenNativeHandles.Contains([string]$nativeHandleValue)) { continue }
      $label = ''
      $parentKey = [string]$record.parent
      if ($lastLabelByParent.ContainsKey($parentKey)) { $label = [string]$lastLabelByParent[$parentKey] }
      $isPassword = $className -match '(?i)password'
      $isReadOnly = $false
      $identities = @($label, $className) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
      $excluded = $isPassword
      if (-not $excluded) {
        foreach ($identity in $identities) {
          if (Matches-Pattern $identity $config.exclude) { $excluded = $true; break }
        }
      }
      $matches = @()
      if (-not $excluded) {
        foreach ($rule in @($config.include)) {
          $ruleMatched = $false
          foreach ($identity in $identities) {
            if (Matches-Pattern $identity $rule.patterns) { $ruleMatched = $true; break }
          }
          if ($ruleMatched) {
            $matches += [ordered]@{ key = Clean $rule.key 80; label = Clean $rule.label 120; maxChars = [Math]::Max(256, [Math]::Min($maxValueChars, [int]$rule.maxChars)) }
          }
        }
      }
      $value = $null
      if ($readValues -and -not $excluded -and $matches.Count -gt 0 -and -not $isPassword) {
        try { $value = Native-Text $record.handle $maxValueChars } catch { $value = $null; $inaccessible++ }
      }
      $valueBase64 = $null
      if ($null -ne $value) { $valueBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$value)) }
      $fields += [ordered]@{
        name = ''
        label = $(if ($label) { $label } else { $className })
        automationId = ''
        helpText = ''
        labeledBy = $label
        className = $className
        frameworkId = 'Win32'
        controlType = 'ControlType.Edit'
        processId = [int]$rootCurrent.ProcessId
        nativeWindowHandle = $nativeHandleValue
        runtimeId = "native.$nativeHandleValue"
        isEnabled = [bool][RadimoFieldMapperUser32]::IsWindowEnabled($record.handle)
        isOffscreen = -not [bool][RadimoFieldMapperUser32]::IsWindowVisible($record.handle)
        isPassword = $isPassword
        isReadOnly = $isReadOnly
        supportsValue = $true
        supportsText = $className -match '(?i)richedit|memo'
        identities = @($identities)
        excluded = $excluded
        matches = @($matches)
        valueBase64 = $valueBase64
        valueChars = $(if ($null -eq $value) { 0 } else { ([string]$value).Length })
      }
      $textFields++
    }
  } catch { $nativeError = ([string]$_.Exception.Message) + ' @ ' + ([string]$_.InvocationInfo.PositionMessage); $inaccessible++ }
  $processName = ''
  try { $processName = [Diagnostics.Process]::GetProcessById([int]$rootCurrent.ProcessId).ProcessName + '.exe' } catch { $processName = '' }
  $started.Stop()
  Emit @{ ok = $true; schema = 'reporthalo.field-scan.v1'; generatedAt = [DateTime]::UtcNow.ToString('o'); windowHandle = $window; windowHandleSource = $(if ($requested -gt 0) { 'requested' } else { 'foreground' }); processId = [int]$rootCurrent.ProcessId; processName = $processName; frameworkId = Clean $rootCurrent.FrameworkId 80; controlType = Clean $rootCurrent.ControlType.ProgrammaticName 120; fields = @($fields); diagnostics = @{ scanned = $processed; textFields = $textFields; inaccessibleFields = $inaccessible; truncated = $truncated; durationMs = $started.ElapsedMilliseconds; readValues = $readValues; nativeFallbackError = $nativeError } }
}
Scan-Window
`;

const FIELD_FOCUS_POWERSHELL = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RadimoMappedFieldUser32 {
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetFocus();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
}
'@
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 8 }
function Root-Window([Int64]$value) {
  if ($value -le 0) { return 0 }
  $root = [RadimoMappedFieldUser32]::GetAncestor([IntPtr]::new($value), 2)
  if ($root -ne [IntPtr]::Zero) { return $root.ToInt64() }
  return $value
}
function Runtime-Id($element) {
  try { return ($element.GetRuntimeId() -join '.') } catch { return '' }
}
function Find-MappedElement($root, [string]$runtimeId, [string]$automationId, [string]$controlType, [string]$name) {
  $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($candidate in @($elements)) {
    try {
      $current = $candidate.Current
      if ($runtimeId -and (Runtime-Id $candidate) -eq $runtimeId) { return $candidate }
    } catch { continue }
  }
  foreach ($candidate in @($elements)) {
    try {
      $current = $candidate.Current
      if ($automationId -and $current.AutomationId -eq $automationId -and (!$controlType -or $current.ControlType.ProgrammaticName -eq $controlType)) { return $candidate }
      if ($name -and $current.Name -eq $name -and (!$controlType -or $current.ControlType.ProgrammaticName -eq $controlType)) { return $candidate }
    } catch { continue }
  }
  return $null
}
function Focus-Native([Int64]$windowHandle, [Int64]$controlHandle) {
  $rootHandle = [IntPtr]::new($windowHandle)
  $targetHandle = [IntPtr]::new($controlHandle)
  $targetProcess = 0
  $targetThread = [RadimoMappedFieldUser32]::GetWindowThreadProcessId($targetHandle, [ref]$targetProcess)
  $currentThread = [RadimoMappedFieldUser32]::GetCurrentThreadId()
  $attached = $false
  try {
    if ($targetThread -and $targetThread -ne $currentThread) { $attached = [RadimoMappedFieldUser32]::AttachThreadInput($currentThread, $targetThread, $true) }
    [RadimoMappedFieldUser32]::SetForegroundWindow($rootHandle) | Out-Null
    [RadimoMappedFieldUser32]::BringWindowToTop($rootHandle) | Out-Null
    [RadimoMappedFieldUser32]::SetActiveWindow($rootHandle) | Out-Null
    Start-Sleep -Milliseconds 120
    [RadimoMappedFieldUser32]::SetFocus($targetHandle) | Out-Null
    return [RadimoMappedFieldUser32]::GetFocus().ToInt64()
  } finally {
    if ($attached) { [RadimoMappedFieldUser32]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null }
  }
}
function Focus-MappedField {
  $window = 0
  $control = 0
  if ($env:RADIMO_FIELD_SCAN_WINDOW) { [Int64]::TryParse($env:RADIMO_FIELD_SCAN_WINDOW, [ref]$window) | Out-Null }
  if ($env:RADIMO_FIELD_CONTROL_WINDOW) { [Int64]::TryParse($env:RADIMO_FIELD_CONTROL_WINDOW, [ref]$control) | Out-Null }
  $window = Root-Window $window
  $helper = 0
  if ($env:RADIMO_HELPER_WINDOW) { [Int64]::TryParse($env:RADIMO_HELPER_WINDOW, [ref]$helper) | Out-Null }
  if ($window -le 0) { Emit @{ ok = $false; error = 'no-target-window' }; return }
  if ($helper -gt 0 -and $window -eq $helper) { Emit @{ ok = $false; error = 'helper-window' }; return }
  try {
    if ($control -gt 0 -and (Root-Window $control) -ne $window) { Emit @{ ok = $false; error = 'target-not-in-window' }; return }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($window))
    $element = $null
    if ($control -gt 0) { try { $element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($control)) } catch { $element = $null } }
    if ($null -eq $element) { $element = Find-MappedElement $root $env:RADIMO_FIELD_RUNTIME_ID $env:RADIMO_FIELD_AUTOMATION_ID $env:RADIMO_FIELD_CONTROL_TYPE $env:RADIMO_FIELD_NAME }
    if ($null -eq $element -and $control -le 0) { Emit @{ ok = $false; error = 'mapped-field-not-found' }; return }
    $current = $null
    if ($null -ne $element) { try { $current = $element.Current } catch { $current = $null } }
    $expectedProcess = 0
    if ($env:RADIMO_FIELD_PROCESS) { [int]::TryParse($env:RADIMO_FIELD_PROCESS, [ref]$expectedProcess) | Out-Null }
    if ($null -ne $current -and $expectedProcess -gt 0 -and $current.ProcessId -ne $expectedProcess) { Emit @{ ok = $false; error = 'target-process-changed' }; return }
    $focusedHandle = 0
    if ($control -gt 0) {
      $focusedHandle = Focus-Native $window $control
      if ($focusedHandle -ne $control) { Emit @{ ok = $false; error = 'focus-not-confirmed'; focusedWindowHandle = $focusedHandle }; return }
    } else {
      if (-not [RadimoMappedFieldUser32]::SetForegroundWindow([IntPtr]::new($window))) { Emit @{ ok = $false; error = 'focus-rejected' }; return }
      Start-Sleep -Milliseconds 120
      $element.SetFocus()
    }
    Start-Sleep -Milliseconds 100
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $verified = $false
    $focusedRuntimeId = ''
    $focusedNative = 0
    try {
      $focusedRuntimeId = Runtime-Id $focused
      $focusedNative = [int64]$focused.Current.NativeWindowHandle
      $verified = if ($control -gt 0) { $focusedNative -eq $control -or $focusedHandle -eq $control } else { $focusedRuntimeId -eq $env:RADIMO_FIELD_RUNTIME_ID }
    } catch { $verified = $false }
    Emit @{ ok = $true; verified = $verified; windowHandle = $window; controlWindowHandle = $control; runtimeId = $(if ($env:RADIMO_FIELD_RUNTIME_ID) { $env:RADIMO_FIELD_RUNTIME_ID } else { $focusedRuntimeId }); focusedWindowHandle = $focusedNative; processId = $expectedProcess; controlType = $env:RADIMO_FIELD_CONTROL_TYPE; automationId = $env:RADIMO_FIELD_AUTOMATION_ID; title = $env:RADIMO_FIELD_NAME }
  } catch { Emit @{ ok = $false; error = [string]$_.Exception.Message } }
}
Focus-MappedField
`;

function runPowerShell(environment = {}, script = POWERSHELL, timeoutMs = 15000) {
  if (process.platform !== "win32") return Promise.resolve({ ok: false, error: "windows-only" });
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", "-"], {
      windowsHide: true,
      env: { ...process.env, ...environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.stdin.end(`${script}\r\n`, "utf8");
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
      finish({ ok: false, error: "windows-automation-timeout" });
    }, timeoutMs);
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("close", (code) => {
      if (settled) return;
      try {
        const result = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}");
        finish({ ...result, processCode: code, stderr: stderr.trim().slice(0, 1000) });
      } catch (error) {
        finish({
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
    RADIMO_FIELD_CONTROL_WINDOW: String(target?.controlWindowHandle || target?.nativeWindowHandle || ""),
    RADIMO_FIELD_NAME: String(target?.title || ""),
    RADIMO_FIELD_SELECTION_ONLY: target?.strategy === "TextPattern.Selection" ? "true" : "false",
    RADIMO_FIELD_EXPECTED_HASH: String(target?.expectedFieldHash || ""),
    RADIMO_FIELD_INSERT_AT_CURSOR: target?.insertAtCursor ? "true" : "false",
  };
}

async function readFocusedField({ selectionOnly = false, helperWindowHandle = "", windowHandle = "", processId = "", controlWindowHandle = "" } = {}) {
  if (controlWindowHandle && !windowHandle) return { ok: false, error: "target-window-required" };
  const result = await runPowerShell({
    RADIMO_FIELD_SELECTION_ONLY: selectionOnly ? "true" : "false",
    RADIMO_HELPER_WINDOW: String(helperWindowHandle || ""),
    RADIMO_FIELD_EXPECTED_WINDOW: String(windowHandle || ""),
    RADIMO_FIELD_EXPECTED_PROCESS: String(processId || ""),
    RADIMO_FIELD_CONTROL_WINDOW: String(controlWindowHandle || ""),
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
  const result = await runPowerShell({
    ...fieldEnvironment(target),
    RADIMO_FIELD_ACTION: "write",
    RADIMO_FIELD_TEXT: text,
    RADIMO_FIELD_REPLACE_ALL: target.replaceAll ? "true" : "false",
    RADIMO_FIELD_APPEND: target.append ? "true" : "false",
    RADIMO_FIELD_FORCE_CLIPBOARD: target.forceClipboard ? "true" : "false",
  });
  if (typeof result.actualTextBase64 === "string") {
    result.actualText = Buffer.from(result.actualTextBase64, "base64").toString("utf8");
    delete result.actualTextBase64;
  }
  return result;
}

async function scanFieldWindow({ windowHandle = "", target = null, helperWindowHandle = "", profile, readValues = false } = {}) {
  const normalizedProfile = normalizeFieldMapperProfile(profile);
  const configBase64 = Buffer.from(JSON.stringify(normalizedProfile), "utf8").toString("base64");
  const result = await runPowerShell({
    RADIMO_FIELD_SCAN_WINDOW: String(windowHandle || target?.windowHandle || ""),
    RADIMO_HELPER_WINDOW: String(helperWindowHandle || ""),
    RADIMO_FIELD_MAPPER_CONFIG_B64: configBase64,
    RADIMO_FIELD_READ_VALUES: readValues ? "true" : "false",
  }, FIELD_SCAN_POWERSHELL, 12000);
  const fields = Array.isArray(result.fields) ? result.fields : result.fields ? [result.fields] : [];
  for (const field of fields) {
    if (Array.isArray(field.matches)) continue;
    field.matches = field.matches ? [field.matches] : [];
  }
  for (const field of fields) {
    if (typeof field.valueBase64 === "string") {
      field.value = Buffer.from(field.valueBase64, "base64").toString("utf8");
      delete field.valueBase64;
    }
  }
  if (result.fields) result.fields = fields;
  return result;
}

async function focusMappedField({ windowHandle = "", target = null, helperWindowHandle = "" } = {}) {
  const resolvedWindow = String(windowHandle || target?.windowHandle || "");
  const resolvedTarget = target || {};
  if (!resolvedWindow) return { ok: false, verified: false, error: "no-target-window" };
  return runPowerShell({
    RADIMO_FIELD_SCAN_WINDOW: resolvedWindow,
    RADIMO_HELPER_WINDOW: String(helperWindowHandle || ""),
    RADIMO_FIELD_PROCESS: String(resolvedTarget.processId || ""),
    RADIMO_FIELD_CONTROL_WINDOW: String(resolvedTarget.controlWindowHandle || resolvedTarget.nativeWindowHandle || ""),
    RADIMO_FIELD_RUNTIME_ID: String(resolvedTarget.runtimeId || ""),
    RADIMO_FIELD_AUTOMATION_ID: String(resolvedTarget.automationId || ""),
    RADIMO_FIELD_CONTROL_TYPE: String(resolvedTarget.controlType || ""),
    RADIMO_FIELD_NAME: String(resolvedTarget.name || resolvedTarget.title || ""),
  }, FIELD_FOCUS_POWERSHELL, 10000);
}

module.exports = { fieldEnvironment, focusMappedField, readFocusedField, scanFieldWindow, writeFocusedField };
