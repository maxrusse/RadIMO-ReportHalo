const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { normalizeFieldMapperProfile } = require("./windows-field-mapper");

// This bridge is intentionally narrow. It uses the .NET UI Automation client
// only when the user explicitly selects UIA mode and never compiles native
// User32 code, sends keystrokes, or requests an execution-policy bypass.
const SAFE_READ_POWERSHELL = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 12 }
function Clean([object]$value, [int]$maxChars = 240) {
  if ($null -eq $value) { return '' }
  $text = ([string]$value).Trim()
  if ($text.Length -gt $maxChars) { return $text.Substring(0, $maxChars) }
  return $text
}
function Runtime-Id($element) {
  try { return ($element.GetRuntimeId() -join '.') } catch { return '' }
}
function Window-Ancestor($element) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $currentElement = $element
  $bestWindow = $null
  $bestWithHandle = $null
  for ($depth = 0; $depth -lt 64 -and $null -ne $currentElement; $depth++) {
    try {
      $current = $currentElement.Current
      $nativeHandle = 0
      try { $nativeHandle = [int64]$current.NativeWindowHandle } catch { }
      if ($nativeHandle -gt 0) { $bestWithHandle = $currentElement }
      if ($current.ControlType.ProgrammaticName -eq 'ControlType.Window') { $bestWindow = $currentElement }
    } catch { }
    try { $currentElement = $walker.GetParent($currentElement) } catch { break }
  }
  if ($null -ne $bestWindow) { return $bestWindow }
  return $bestWithHandle
}
function Requested-Int64([string]$name) {
  $value = 0
  $raw = [Environment]::GetEnvironmentVariable($name)
  if ($raw) { [Int64]::TryParse($raw, [ref]$value) | Out-Null }
  return $value
}
function Nearby-Label($element) {
  $current = $null
  try { $current = $element.Current } catch { return '' }
  try {
    if ($null -ne $current.LabeledBy) {
      $label = Clean ($current.LabeledBy.Current.Name) 240
      if ($label) { return $label }
    }
  } catch { }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $parent = $null
  try { $parent = $walker.GetParent($element) } catch { $parent = $null }
  if ($null -eq $parent) { return '' }
  try {
    $children = @($parent.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition))
    $elementId = Runtime-Id $element
    $index = -1
    for ($childIndex = 0; $childIndex -lt $children.Count; $childIndex++) {
      if ((Runtime-Id $children[$childIndex]) -eq $elementId) { $index = $childIndex; break }
    }
    for ($childIndex = $index - 1; $childIndex -ge [Math]::Max(0, $index - 3); $childIndex--) {
      $sibling = $children[$childIndex]
      $siblingCurrent = $sibling.Current
      $siblingType = [string]$siblingCurrent.ControlType.ProgrammaticName
      $siblingName = Clean $siblingCurrent.Name 240
      if ($siblingName -and $siblingType -match '(?i)Text|Header|Group') { return $siblingName }
    }
  } catch { }
  return ''
}
function Container-Names($element) {
  $names = New-Object 'System.Collections.Generic.List[System.String]'
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $currentElement = $element
  for ($depth = 0; $depth -lt 5 -and $null -ne $currentElement; $depth++) {
    try { $currentElement = $walker.GetParent($currentElement) } catch { break }
    if ($null -eq $currentElement) { break }
    try {
      $current = $currentElement.Current
      $controlType = [string]$current.ControlType.ProgrammaticName
      $name = Clean $current.Name 240
      if ($name -and $controlType -match '(?i)Group|Pane|Tab|Header') { [void]$names.Add($name) }
    } catch { }
  }
  return $names.ToArray()
}
function Add-Candidate($list, $element) {
  if ($null -eq $element) { return }
  $runtimeId = Runtime-Id $element
  foreach ($existing in $list.ToArray()) {
    if ($runtimeId -and (Runtime-Id $existing) -eq $runtimeId) { return }
  }
  [void]$list.Add($element)
}
function Add-CandidateChain($list, $element) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $current = $element
  for ($depth = 0; $depth -lt 10 -and $null -ne $current; $depth++) {
    Add-Candidate $list $current
    try { $current = $walker.GetParent($current) } catch { break }
  }
}
function Point-Candidates($list) {
  $x = 0.0
  $y = 0.0
  $pointOk = $false
  try {
    if ($env:RADIMO_FIELD_POINT_X -and $env:RADIMO_FIELD_POINT_Y) {
      $pointOk = [double]::TryParse($env:RADIMO_FIELD_POINT_X, [ref]$x) -and [double]::TryParse($env:RADIMO_FIELD_POINT_Y, [ref]$y)
    }
  } catch { $pointOk = $false }
  if (-not $pointOk) { return }
  $points = New-Object 'System.Collections.Generic.List[System.Object]'
  [void]$points.Add(@($x, $y))
  $scale = 1.0
  try { if ($env:RADIMO_FIELD_POINT_SCALE) { [double]::TryParse($env:RADIMO_FIELD_POINT_SCALE, [ref]$scale) | Out-Null } } catch { $scale = 1.0 }
  if ($scale -gt 0.5 -and $scale -lt 4.0 -and [Math]::Abs($scale - 1.0) -gt 0.01) {
    [void]$points.Add(@($x * $scale, $y * $scale))
    [void]$points.Add(@($x / $scale, $y / $scale))
  }
  foreach ($point in $points.ToArray()) {
    try { Add-CandidateChain $list ([System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new([double]$point[0], [double]$point[1]))) } catch { }
  }
}
function Focused-Candidates($list) {
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    try {
      $element = [System.Windows.Automation.AutomationElement]::FocusedElement
      if ($null -ne $element) { Add-CandidateChain $list $element; return }
    } catch { }
    Start-Sleep -Milliseconds 45
  }
}
function Element-Text($element, [bool]$selectionOnly = $false) {
  $valuePattern = $null
  $hasValue = $false
  try { $hasValue = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) } catch { $hasValue = $false }
  $supportsWrite = $null
  if ($hasValue) {
    try { $supportsWrite = -not [bool]$valuePattern.Current.IsReadOnly } catch { $supportsWrite = $null }
  }
  if (-not $selectionOnly -and $hasValue) {
    try { return [pscustomobject]@{ available = $true; text = [string]$valuePattern.Current.Value; strategy = 'ValuePattern'; supportsWrite = $supportsWrite } } catch { }
  }
  $textPattern = $null
  $hasText = $false
  try { $hasText = $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern) } catch { $hasText = $false }
  if ($hasText -and $selectionOnly) {
    try {
      $selection = $textPattern.GetSelection()
      if ($selection -and $selection.Length -gt 0) {
        $selected = (($selection | ForEach-Object { $_.GetText(-1) }) -join '')
        if (-not [string]::IsNullOrWhiteSpace($selected)) {
          return [pscustomobject]@{ available = $true; text = $selected; strategy = 'TextPattern.Selection'; supportsWrite = $supportsWrite }
        }
      }
    } catch { }
    return [pscustomobject]@{ available = $false; text = $null; strategy = 'TextPattern.Selection'; supportsWrite = $supportsWrite; error = 'no-selection' }
  }
  if ($hasText) {
    try { return [pscustomobject]@{ available = $true; text = [string]$textPattern.DocumentRange.GetText(-1); strategy = 'TextPattern.DocumentRange'; supportsWrite = $supportsWrite } } catch { }
  }
  return [pscustomobject]@{ available = $false; text = $null; strategy = $null; supportsWrite = $supportsWrite }
}
function Element-Info($element, [Int64]$requestedWindow = 0) {
  $current = $element.Current
  $ancestor = Window-Ancestor $element
  $ancestorCurrent = $null
  try { if ($null -ne $ancestor) { $ancestorCurrent = $ancestor.Current } } catch { $ancestorCurrent = $null }
  $controlWindow = 0
  try { $controlWindow = [int64]$current.NativeWindowHandle } catch { $controlWindow = 0 }
  $window = 0
  try { if ($null -ne $ancestorCurrent) { $window = [int64]$ancestorCurrent.NativeWindowHandle } } catch { $window = 0 }
  if ($window -le 0) { $window = $controlWindow }
  if ($window -le 0 -and $requestedWindow -gt 0) { $window = $requestedWindow }
  $labeledBy = ''
  try { $labeledBy = Nearby-Label $element } catch { $labeledBy = '' }
  $runtimeId = Runtime-Id $element
  return [ordered]@{
    windowHandle = $window
    windowHandleSource = $(if ($window -eq $requestedWindow -and $requestedWindow -gt 0) { 'requested' } else { 'uia-ancestor' })
    controlWindowHandle = $controlWindow
    nativeWindowHandle = $controlWindow
    runtimeId = $runtimeId
    processId = [int]$current.ProcessId
    name = Clean $current.Name 240
    title = Clean $current.Name 240
    label = $(if ($labeledBy) { $labeledBy } elseif ($current.Name) { Clean $current.Name 240 } else { 'Unbenanntes Textfeld' })
    labeledBy = $labeledBy
    automationId = Clean $current.AutomationId 180
    helpText = Clean $current.HelpText 240
    className = Clean $current.ClassName 180
    frameworkId = Clean $current.FrameworkId 80
    controlType = Clean ($current.ControlType.ProgrammaticName) 120
    containerNames = @(Container-Names $element)
    isEnabled = [bool]$current.IsEnabled
    isOffscreen = [bool]$current.IsOffscreen
    isPassword = [bool]$current.IsPassword
  }
}
function Read-Focused {
  $requestedWindow = Requested-Int64 'RADIMO_FIELD_EXPECTED_WINDOW'
  $requestedProcess = Requested-Int64 'RADIMO_FIELD_EXPECTED_PROCESS'
  $helperWindow = Requested-Int64 'RADIMO_HELPER_WINDOW'
  $selectionOnly = $env:RADIMO_FIELD_SELECTION_ONLY -eq 'true'
  $helperProcess = Requested-Int64 'RADIMO_HELPER_PROCESS_ID'
  $candidates = New-Object 'System.Collections.Generic.List[System.Object]'
  Point-Candidates $candidates
  Focused-Candidates $candidates
  if ($candidates.Count -eq 0) { Emit @{ ok = $false; error = 'no-focused-element'; accessibility = 'uia' }; return }
  $selectionFailure = $null
  $helperSeen = $false
  foreach ($element in $candidates.ToArray()) {
    try { $info = Element-Info $element $requestedWindow } catch { continue }
    if ($helperWindow -gt 0 -and $info.windowHandle -eq $helperWindow) { $helperSeen = $true; if ($null -eq $selectionFailure) { $selectionFailure = $info }; continue }
    if ($helperProcess -gt 0 -and $info.processId -eq $helperProcess) { $helperSeen = $true; if ($null -eq $selectionFailure) { $selectionFailure = $info }; continue }
    if ($requestedWindow -gt 0 -and $info.windowHandle -ne $requestedWindow) { continue }
    if ($requestedProcess -gt 0 -and $info.processId -ne $requestedProcess) { continue }
    $read = Element-Text $element $selectionOnly
    if (-not $read.available) {
      if ($read.error -eq 'no-selection' -and $null -eq $selectionFailure) { $selectionFailure = $info }
      continue
    }
    if (-not $info.isEnabled -or $info.isOffscreen) { continue }
    $fieldLike = $info.controlType -match '(?i)Edit|Document|ComboBox|Custom'
    if (-not $fieldLike) { continue }
    $textBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$read.text))
    Emit (@{ ok = $true; textBase64 = $textBase64; hash = $null; accessibility = 'uia'; readable = $true; supportsWrite = $read.supportsWrite; approximate = ($read.strategy -ne 'ValuePattern'); replaceAll = ($read.strategy -ne 'TextPattern.Selection'); strategy = $read.strategy } + $info)
    return
  }
  if ($null -ne $selectionFailure -and $selectionOnly) { Emit (@{ ok = $false; error = 'no-selection'; accessibility = 'uia'; readable = $false; strategy = 'TextPattern.Selection' } + $selectionFailure); return }
  if ($helperSeen) { Emit @{ ok = $false; error = 'helper-focused'; accessibility = 'uia'; windowHandle = $helperWindow; processId = $helperProcess }; return }
  Emit @{ ok = $false; error = 'accessibility-unavailable'; accessibility = 'not-exposed'; readable = $false }
}
Read-Focused
`;

const SAFE_WRITE_POWERSHELL = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 12 }
function Runtime-Id($element) { try { return ($element.GetRuntimeId() -join '.') } catch { return '' } }
function Window-Ancestor($element) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $currentElement = $element
  $bestWindow = $null
  $bestWithHandle = $null
  for ($depth = 0; $depth -lt 64 -and $null -ne $currentElement; $depth++) {
    try {
      $current = $currentElement.Current
      $nativeHandle = 0
      try { $nativeHandle = [int64]$current.NativeWindowHandle } catch { }
      if ($nativeHandle -gt 0) { $bestWithHandle = $currentElement }
      if ($current.ControlType.ProgrammaticName -eq 'ControlType.Window') { $bestWindow = $currentElement }
    } catch { }
    try { $currentElement = $walker.GetParent($currentElement) } catch { break }
  }
  if ($null -ne $bestWindow) { return $bestWindow }
  return $bestWithHandle
}
function Requested-Int64([string]$name) {
  $value = 0
  $raw = [Environment]::GetEnvironmentVariable($name)
  if ($raw) { [Int64]::TryParse($raw, [ref]$value) | Out-Null }
  return $value
}
function Element-Text($element) {
  $valuePattern = $null
  try {
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
      return [pscustomobject]@{ available = $true; text = [string]$valuePattern.Current.Value; pattern = $valuePattern; writable = (-not [bool]$valuePattern.Current.IsReadOnly) }
    }
  } catch { }
  $textPattern = $null
  try {
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
      return [pscustomobject]@{ available = $true; text = [string]$textPattern.DocumentRange.GetText(-1); pattern = $null; writable = $false }
    }
  } catch { }
  return [pscustomobject]@{ available = $false; text = $null; pattern = $null; writable = $false }
}
function Element-Matches($element, [string]$runtimeId, [string]$automationId, [string]$controlType, [string]$name) {
  try {
    $current = $element.Current
    if ($runtimeId) { return ((Runtime-Id $element) -eq $runtimeId -and (!$controlType -or $current.ControlType.ProgrammaticName -eq $controlType)) }
    if ($automationId) { return ($current.AutomationId -eq $automationId -and (!$controlType -or $current.ControlType.ProgrammaticName -eq $controlType)) }
    if ($name) { return ($current.Name -eq $name -and (!$controlType -or $current.ControlType.ProgrammaticName -eq $controlType)) }
    if ($controlType) { return ($current.ControlType.ProgrammaticName -eq $controlType) }
  } catch { }
  return $false
}
function Hash-Text([string]$value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Find-TargetElement($root, [string]$runtimeId, [string]$automationId, [string]$controlType, [string]$name, [Int64]$controlWindow) {
  if ($null -eq $root) { return $null }
  $elements = New-Object 'System.Collections.Generic.List[System.Object]'
  [void]$elements.Add($root)
  foreach ($candidate in @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))) { [void]$elements.Add($candidate) }
  foreach ($candidate in $elements.ToArray()) {
    if (Element-Matches $candidate $runtimeId $automationId $controlType $name) { return $candidate }
  }
  if ($controlWindow -gt 0) {
    try {
      $fromHandle = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($controlWindow))
      if ($null -ne $fromHandle -and (Element-Matches $fromHandle $runtimeId $automationId $controlType $name)) { return $fromHandle }
      if ($null -ne $fromHandle -and -not $runtimeId -and -not $automationId -and -not $name -and -not $controlType) { return $fromHandle }
    } catch { }
  }
  return $null
}
function Write-Focused([string]$text) {
  $window = Requested-Int64 'RADIMO_FIELD_WINDOW'
  $process = Requested-Int64 'RADIMO_FIELD_PROCESS'
  $controlWindow = Requested-Int64 'RADIMO_FIELD_CONTROL_WINDOW'
  if ($window -le 0) { Emit @{ ok = $false; verified = $false; error = 'no-target-window'; accessibility = 'uia' }; return }
  if ($env:RADIMO_FIELD_INSERT_AT_CURSOR -eq 'true') { Emit @{ ok = $false; verified = $false; error = 'cursor-insertion-requires-manual-paste'; accessibility = 'uia' }; return }
  if ($env:RADIMO_FIELD_REPLACE_ALL -ne 'true') { Emit @{ ok = $false; verified = $false; error = 'selection-write-requires-manual-paste'; accessibility = 'uia' }; return }
  $root = $null
  try { $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($window)) } catch { }
  $element = Find-TargetElement $root $env:RADIMO_FIELD_RUNTIME_ID $env:RADIMO_FIELD_AUTOMATION_ID $env:RADIMO_FIELD_CONTROL_TYPE $env:RADIMO_FIELD_NAME $controlWindow
  if ($null -eq $element) { Emit @{ ok = $false; verified = $false; error = 'target-control-unavailable'; accessibility = 'uia' }; return }
  try { $current = $element.Current } catch { Emit @{ ok = $false; verified = $false; error = 'target-control-unavailable'; accessibility = 'uia' }; return }
  $ancestor = Window-Ancestor $element
  $observedWindow = 0
  try { if ($null -ne $ancestor) { $observedWindow = [int64]$ancestor.Current.NativeWindowHandle } } catch { }
  if ($observedWindow -le 0) { $observedWindow = $window }
  if ($observedWindow -ne $window) { Emit @{ ok = $false; verified = $false; error = 'target-window-changed'; accessibility = 'uia'; expectedWindow = $window; actualWindow = $observedWindow }; return }
  if ($process -gt 0 -and [int]$current.ProcessId -ne $process) { Emit @{ ok = $false; verified = $false; error = 'target-process-changed'; accessibility = 'uia' }; return }
  if ($env:RADIMO_FIELD_RUNTIME_ID -and (Runtime-Id $element) -ne $env:RADIMO_FIELD_RUNTIME_ID) { Emit @{ ok = $false; verified = $false; error = 'target-control-changed'; accessibility = 'uia' }; return }
  $before = Element-Text $element
  if (-not $before.available -or $null -eq $before.pattern -or -not $before.writable) { Emit @{ ok = $false; verified = $false; error = 'target-write-unsupported'; accessibility = 'not-exposed'; readable = $before.available }; return }
  if ($env:RADIMO_FIELD_EXPECTED_HASH) {
    if ((Hash-Text ([string]$before.text)) -ne $env:RADIMO_FIELD_EXPECTED_HASH) { Emit @{ ok = $false; verified = $false; error = 'target-text-changed'; accessibility = 'uia' }; return }
  }
  $append = $env:RADIMO_FIELD_APPEND -eq 'true'
  $nextText = [string]$text
  if ($append) {
    $separator = ''
    if (-not [string]::IsNullOrEmpty([string]$before.text) -and [string]$text -notmatch '^\s*\r?\n' -and [string]$before.text -notmatch '\r?\n\s*$') { $separator = [Environment]::NewLine + [Environment]::NewLine }
    $nextText = [string]$before.text + $separator + [string]$text
  }
  try { $before.pattern.SetValue($nextText) } catch { Emit @{ ok = $false; verified = $false; error = 'target-write-failed'; accessibility = 'uia' }; return }
  Start-Sleep -Milliseconds 160
  $after = Element-Text $element
  $actual = if ($after.available) { [string]$after.text } else { $null }
  $actualHash = if ($null -ne $actual) { Hash-Text $actual } else { $null }
  $actualTextBase64 = if ($null -ne $actual) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($actual)) } else { $null }
  Emit @{ ok = $true; verified = ($null -ne $actual -and $actual -eq $nextText); readable = ($null -ne $actual); actualHash = $actualHash; actualTextBase64 = $actualTextBase64; strategy = 'SafeUIA.ValuePattern.SetValue'; accessibility = 'uia'; error = $null }
}
Write-Focused $env:RADIMO_FIELD_TEXT
`;

const SAFE_SCAN_POWERSHELL = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 12 }
function Clean([object]$value, [int]$maxChars = 240) {
  if ($null -eq $value) { return '' }
  $text = ([string]$value).Trim()
  if ($text.Length -gt $maxChars) { return $text.Substring(0, $maxChars) }
  return $text
}
function Runtime-Id($element) { try { return ($element.GetRuntimeId() -join '.') } catch { return '' } }
function Window-Ancestor($element) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $currentElement = $element
  $bestWindow = $null
  $bestWithHandle = $null
  for ($depth = 0; $depth -lt 64 -and $null -ne $currentElement; $depth++) {
    try {
      $current = $currentElement.Current
      $nativeHandle = 0
      try { $nativeHandle = [int64]$current.NativeWindowHandle } catch { }
      if ($nativeHandle -gt 0) { $bestWithHandle = $currentElement }
      if ($current.ControlType.ProgrammaticName -eq 'ControlType.Window') { $bestWindow = $currentElement }
    } catch { }
    try { $currentElement = $walker.GetParent($currentElement) } catch { break }
  }
  if ($null -ne $bestWindow) { return $bestWindow }
  return $bestWithHandle
}
function Root-Element([Int64]$requested) {
  if ($requested -gt 0) { try { return [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($requested)) } catch { return $null } }
  try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $ancestor = Window-Ancestor $focused
    if ($null -ne $ancestor) { return $ancestor }
    $focusedCurrent = $focused.Current
    if ([int64]$focusedCurrent.NativeWindowHandle -gt 0) { return $focused }
  } catch { }
  return $null
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
  try {
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
      $text = [string]$valuePattern.Current.Value
      if ($text.Length -gt $maxChars) { return $text.Substring(0, $maxChars) }
      return $text
    }
  } catch { }
  $textPattern = $null
  try {
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
      $text = [string]$textPattern.DocumentRange.GetText(-1)
      if ($text.Length -gt $maxChars) { return $text.Substring(0, $maxChars) }
      return $text
    }
  } catch { }
  return $null
}
function Nearby-Label($element) {
  $current = $null
  try { $current = $element.Current } catch { return '' }
  try {
    if ($null -ne $current.LabeledBy) {
      $label = Clean ($current.LabeledBy.Current.Name) 240
      if ($label) { return $label }
    }
  } catch { }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $parent = $null
  try { $parent = $walker.GetParent($element) } catch { $parent = $null }
  if ($null -eq $parent) { return '' }
  try {
    $children = @($parent.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition))
    $elementId = Runtime-Id $element
    $index = -1
    for ($childIndex = 0; $childIndex -lt $children.Count; $childIndex++) {
      if ((Runtime-Id $children[$childIndex]) -eq $elementId) { $index = $childIndex; break }
    }
    for ($childIndex = $index - 1; $childIndex -ge [Math]::Max(0, $index - 3); $childIndex--) {
      $siblingCurrent = $children[$childIndex].Current
      $siblingType = [string]$siblingCurrent.ControlType.ProgrammaticName
      $siblingName = Clean $siblingCurrent.Name 240
      if ($siblingName -and $siblingType -match '(?i)Text|Header|Group') { return $siblingName }
    }
  } catch { }
  return ''
}
function Container-Names($element) {
  $names = New-Object 'System.Collections.Generic.List[System.String]'
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $currentElement = $element
  for ($depth = 0; $depth -lt 5 -and $null -ne $currentElement; $depth++) {
    try { $currentElement = $walker.GetParent($currentElement) } catch { break }
    if ($null -eq $currentElement) { break }
    try {
      $current = $currentElement.Current
      $controlType = [string]$current.ControlType.ProgrammaticName
      $name = Clean $current.Name 240
      if ($name -and $controlType -match '(?i)Group|Pane|Tab|Header') { [void]$names.Add($name) }
    } catch { }
  }
  return $names.ToArray()
}
function Scan-Window {
  $started = [Diagnostics.Stopwatch]::StartNew()
  try { $config = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:RADIMO_FIELD_MAPPER_CONFIG_B64)) | ConvertFrom-Json) } catch { Emit @{ ok = $false; error = 'invalid-field-mapper-config'; accessibility = 'uia' }; return }
  $requested = 0
  if ($env:RADIMO_FIELD_SCAN_WINDOW) { [Int64]::TryParse($env:RADIMO_FIELD_SCAN_WINDOW, [ref]$requested) | Out-Null }
  $requestedProcess = 0
  if ($env:RADIMO_FIELD_SCAN_PROCESS) { [Int64]::TryParse($env:RADIMO_FIELD_SCAN_PROCESS, [ref]$requestedProcess) | Out-Null }
  $root = Root-Element $requested
  if ($null -eq $root) { Emit @{ ok = $false; error = 'window-not-accessible'; accessibility = 'not-exposed'; strategy = 'uia-only' }; return }
  try { $rootCurrent = $root.Current } catch { Emit @{ ok = $false; error = 'window-properties-unavailable'; accessibility = 'uia' }; return }
  $window = [int64]$rootCurrent.NativeWindowHandle
  if ($window -le 0) { $window = $requested }
  if ($requestedProcess -gt 0 -and [int64]$rootCurrent.ProcessId -ne $requestedProcess) { Emit @{ ok = $false; error = 'target-process-changed'; accessibility = 'uia'; expectedProcess = $requestedProcess; actualProcess = [int64]$rootCurrent.ProcessId; windowHandle = $window }; return }
  $helperWindow = 0
  if ($env:RADIMO_HELPER_WINDOW) { [Int64]::TryParse($env:RADIMO_HELPER_WINDOW, [ref]$helperWindow) | Out-Null }
  $helperProcess = 0
  if ($env:RADIMO_HELPER_PROCESS_ID) { [Int64]::TryParse($env:RADIMO_HELPER_PROCESS_ID, [ref]$helperProcess) | Out-Null }
  if ($helperWindow -gt 0 -and $window -eq $helperWindow) { Emit @{ ok = $false; error = 'helper-window'; windowHandle = $window; accessibility = 'uia' }; return }
  if ($helperProcess -gt 0 -and [int64]$rootCurrent.ProcessId -eq $helperProcess) { Emit @{ ok = $false; error = 'helper-window'; windowHandle = $window; processId = [int64]$rootCurrent.ProcessId; accessibility = 'uia' }; return }
  $maxFields = [Math]::Max(20, [Math]::Min(250, [int]$config.limits.maxFields))
  $maxValueChars = [Math]::Max(256, [Math]::Min(20000, [int]$config.limits.maxValueChars))
  $readValues = $env:RADIMO_FIELD_READ_VALUES -eq 'true'
  $fields = New-Object 'System.Collections.Generic.List[System.Object]'
  $processed = 0
  $textFields = 0
  $inaccessible = 0
  $truncated = $false
  try { $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) } catch { Emit @{ ok = $false; error = 'automation-tree-unavailable'; accessibility = 'not-exposed'; strategy = 'uia-only'; windowHandle = $window }; return }
  foreach ($element in @($elements)) {
    $processed++
    if ($fields.Count -ge $maxFields) { $truncated = $true; break }
    try { $current = $element.Current } catch { $inaccessible++; continue }
    $valuePattern = $null
    $textPattern = $null
    $hasValue = $false
    $hasText = $false
    try { $hasValue = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) } catch { $hasValue = $false }
    try { $hasText = $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern) } catch { $hasText = $false }
    if (-not $hasValue -and -not $hasText) { continue }
    $controlType = Clean ($current.ControlType.ProgrammaticName) 120
    $isTextControl = $controlType -match '(?i)Edit|Document|ComboBox|Custom'
    if (-not $isTextControl) { continue }
    $textFields++
    $labeledByName = ''
    try { $labeledByName = Nearby-Label $element } catch { }
    $name = Clean $current.Name 240
    $automationId = Clean $current.AutomationId 180
    $helpText = Clean $current.HelpText 240
    $className = Clean $current.ClassName 180
    $containerNames = @()
    try { $containerNames = @(Container-Names $element) } catch { }
    $identityCandidates = @($labeledByName, $name, $automationId, $helpText) + $containerNames
    $identities = @($identityCandidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    $isPassword = $false
    try { $isPassword = [bool]$current.IsPassword } catch { }
    $excluded = $isPassword
    if (-not $excluded) { foreach ($identity in $identities) { if (Matches-Pattern $identity $config.exclude) { $excluded = $true; break } } }
    $matches = New-Object 'System.Collections.Generic.List[System.Object]'
    if (-not $excluded) {
      foreach ($rule in @($config.include)) {
        $matched = $false
        foreach ($identity in $identities) { if (Matches-Pattern $identity $rule.patterns) { $matched = $true; break } }
        if ($matched) { [void]$matches.Add([ordered]@{ key = Clean $rule.key 80; label = Clean $rule.label 120; maxChars = [Math]::Max(256, [Math]::Min($maxValueChars, [int]$rule.maxChars)) }) }
      }
    }
    $value = $null
    if ($readValues -and -not $excluded -and $matches.Count -gt 0) { try { $value = Read-ElementText $element $maxValueChars } catch { $inaccessible++ } }
    $valueBase64 = if ($null -ne $value) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$value)) } else { $null }
    $nativeHandle = 0
    try { $nativeHandle = [int64]$current.NativeWindowHandle } catch { }
    $isReadOnly = $null
    if ($hasValue) { try { $isReadOnly = [bool]$valuePattern.Current.IsReadOnly } catch { } }
    [void]$fields.Add([ordered]@{
      name = $name
      label = $(if ($labeledByName) { $labeledByName } elseif ($name) { $name } elseif ($automationId) { $automationId } else { 'Unbenanntes Textfeld' })
      automationId = $automationId
      helpText = $helpText
      labeledBy = $labeledByName
      className = $className
      containerNames = @($containerNames)
      frameworkId = Clean $current.FrameworkId 80
      controlType = $controlType
      processId = [int]$current.ProcessId
      nativeWindowHandle = $nativeHandle
      runtimeId = Runtime-Id $element
      isEnabled = [bool]$current.IsEnabled
      isOffscreen = [bool]$current.IsOffscreen
      isPassword = $isPassword
      isReadOnly = $isReadOnly
      supportsWrite = $(if ($null -eq $isReadOnly) { $false } else { -not [bool]$isReadOnly })
      supportsValue = [bool]$hasValue
      supportsText = [bool]$hasText
      readStrategy = $(if ($hasValue) { 'ValuePattern' } elseif ($hasText) { 'TextPattern' } else { '' })
      identities = @($identities)
      excluded = $excluded
      matches = $matches.ToArray()
      valueBase64 = $valueBase64
      valueChars = $(if ($null -eq $value) { 0 } else { ([string]$value).Length })
    })
  }
  $processName = ''
  try { $processName = [Diagnostics.Process]::GetProcessById([int]$rootCurrent.ProcessId).ProcessName + '.exe' } catch { }
  $started.Stop()
  Emit @{ ok = $true; schema = 'reporthalo.field-scan.v1'; generatedAt = [DateTime]::UtcNow.ToString('o'); windowHandle = $window; windowHandleSource = $(if ($requested -gt 0) { 'requested' } else { 'uia-focused-ancestor' }); processId = [int]$rootCurrent.ProcessId; processName = $processName; frameworkId = Clean ($rootCurrent.FrameworkId) 80; controlType = Clean ($rootCurrent.ControlType.ProgrammaticName) 120; fields = $fields.ToArray(); diagnostics = @{ scanned = $processed; textFields = $textFields; inaccessibleFields = $inaccessible; truncated = $truncated; durationMs = $started.ElapsedMilliseconds; readValues = $readValues; strategy = 'uia-only'; patterns = 'ValuePattern, TextPattern'; nativeFallback = $false } }
}
Scan-Window
`;

const SAFE_FOCUS_POWERSHELL = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
function Emit($value) { $value | ConvertTo-Json -Compress -Depth 12 }
function Runtime-Id($element) { try { return ($element.GetRuntimeId() -join '.') } catch { return '' } }
function Element-Matches($element, [string]$runtimeId, [string]$automationId, [string]$controlType, [string]$name) {
  try {
    $current = $element.Current
    if ($runtimeId) { return ((Runtime-Id $element) -eq $runtimeId -and (!$controlType -or $current.ControlType.ProgrammaticName -eq $controlType)) }
    if ($automationId) { return ($current.AutomationId -eq $automationId -and (!$controlType -or $current.ControlType.ProgrammaticName -eq $controlType)) }
    if ($name) { return ($current.Name -eq $name -and (!$controlType -or $current.ControlType.ProgrammaticName -eq $controlType)) }
    if ($controlType) { return ($current.ControlType.ProgrammaticName -eq $controlType) }
  } catch { }
  return $false
}
function Find-Mapped($root, [string]$runtimeId, [string]$automationId, [string]$controlType, [string]$name, [Int64]$controlWindow) {
  if ($null -eq $root) { return $null }
  $elements = New-Object 'System.Collections.Generic.List[System.Object]'
  [void]$elements.Add($root)
  foreach ($child in @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))) { [void]$elements.Add($child) }
  foreach ($candidate in $elements.ToArray()) {
    if (Element-Matches $candidate $runtimeId $automationId $controlType $name) { return $candidate }
  }
  if ($controlWindow -gt 0) {
    try {
      $fromHandle = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($controlWindow))
      if ($null -ne $fromHandle -and (Element-Matches $fromHandle $runtimeId $automationId $controlType $name)) { return $fromHandle }
      if ($null -ne $fromHandle -and -not $runtimeId -and -not $automationId -and -not $name -and -not $controlType) { return $fromHandle }
    } catch { }
  }
  return $null
}
$window = 0
if ($env:RADIMO_FIELD_SCAN_WINDOW) { [Int64]::TryParse($env:RADIMO_FIELD_SCAN_WINDOW, [ref]$window) | Out-Null }
$controlWindow = 0
if ($env:RADIMO_FIELD_CONTROL_WINDOW) { [Int64]::TryParse($env:RADIMO_FIELD_CONTROL_WINDOW, [ref]$controlWindow) | Out-Null }
if ($window -le 0) { Emit @{ ok = $false; verified = $false; error = 'no-target-window'; accessibility = 'uia' }; return }
$root = $null
try { $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new($window)) } catch { }
$element = Find-Mapped $root $env:RADIMO_FIELD_RUNTIME_ID $env:RADIMO_FIELD_AUTOMATION_ID $env:RADIMO_FIELD_CONTROL_TYPE $env:RADIMO_FIELD_NAME $controlWindow
if ($null -eq $element) { Emit @{ ok = $false; verified = $false; error = 'target-control-unavailable'; accessibility = 'not-exposed' }; return }
$focused = $false
try { $element.SetFocus(); $focused = $true } catch { $focused = $false }
if (-not $focused) { Emit @{ ok = $false; verified = $false; error = 'focus-not-supported'; accessibility = 'uia' }; return }
Start-Sleep -Milliseconds 90
$verified = $false
$focusedRuntime = ''
try {
  $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
  $focusedRuntime = Runtime-Id $focusedElement
  $focusedCurrent = $focusedElement.Current
  $verified = if ($env:RADIMO_FIELD_RUNTIME_ID) { $focusedRuntime -eq $env:RADIMO_FIELD_RUNTIME_ID } elseif ($controlWindow -gt 0) { [int64]$focusedCurrent.NativeWindowHandle -eq $controlWindow } else { Element-Matches $focusedElement $env:RADIMO_FIELD_RUNTIME_ID $env:RADIMO_FIELD_AUTOMATION_ID $env:RADIMO_FIELD_CONTROL_TYPE $env:RADIMO_FIELD_NAME }
} catch { }
Emit @{ ok = $true; verified = $verified; accessibility = 'uia'; strategy = 'SafeUIA.SetFocus'; windowHandle = $window; controlWindowHandle = $controlWindow; runtimeId = $(if ($env:RADIMO_FIELD_RUNTIME_ID) { $env:RADIMO_FIELD_RUNTIME_ID } else { $focusedRuntime }); focusedRuntimeId = $focusedRuntime; processId = [int]$env:RADIMO_FIELD_PROCESS }
`;

function parseJsonResult(stdout, stderr, code) {
  try {
    const result = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}");
    return { ...result, processCode: code, stderr: stderr.trim().slice(0, 1000) };
  } catch (error) {
    return {
      ok: false,
      error: stderr.trim() || `powershell-exit-${code}`,
      processCode: code,
      parseError: error?.message || String(error),
      stdoutStart: stdout.trim().slice(0, 600),
      stdoutEnd: stdout.trim().slice(-600),
      stdoutLength: stdout.length,
    };
  }
}

function runSafePowerShell(environment = {}, script = "", timeoutMs = 15000) {
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
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-Command", "-"], {
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
    child.on("close", (code) => { if (!settled) finish(parseJsonResult(stdout, stderr, code)); });
  });
}

function baseEnvironment({ helperWindowHandle = "", helperProcessId = "", pointX = "", pointY = "", pointScale = "" } = {}) {
  return {
    RADIMO_HELPER_WINDOW: String(helperWindowHandle || ""),
    RADIMO_HELPER_PROCESS_ID: String(helperProcessId || ""),
    RADIMO_FIELD_POINT_X: String(pointX ?? ""),
    RADIMO_FIELD_POINT_Y: String(pointY ?? ""),
    RADIMO_FIELD_POINT_SCALE: String(pointScale ?? ""),
  };
}

function targetEnvironment(target = {}) {
  return {
    RADIMO_FIELD_WINDOW: String(target.windowHandle || ""),
    RADIMO_FIELD_EXPECTED_WINDOW: String(target.windowHandle || ""),
    RADIMO_FIELD_PROCESS: String(target.processId || ""),
    RADIMO_FIELD_EXPECTED_PROCESS: String(target.processId || ""),
    RADIMO_FIELD_AUTOMATION_ID: String(target.automationId || ""),
    RADIMO_FIELD_CONTROL_TYPE: String(target.controlType || ""),
    RADIMO_FIELD_RUNTIME_ID: String(target.runtimeId || ""),
    RADIMO_FIELD_CONTROL_WINDOW: String(target.controlWindowHandle || target.nativeWindowHandle || ""),
    RADIMO_FIELD_NAME: String(target.name || target.title || ""),
    RADIMO_FIELD_EXPECTED_HASH: String(target.expectedFieldHash || ""),
    RADIMO_FIELD_INSERT_AT_CURSOR: target.insertAtCursor ? "true" : "false",
    RADIMO_FIELD_APPEND: target.append ? "true" : "false",
    RADIMO_FIELD_REPLACE_ALL: target.replaceAll ? "true" : "false",
    RADIMO_FIELD_TEXT: String(target.text || ""),
  };
}

function decodeBase64Result(result, property, outputProperty = property.replace(/Base64$/, "")) {
  if (typeof result?.[property] === "string") {
    result[outputProperty] = Buffer.from(result[property], "base64").toString("utf8");
    delete result[property];
  }
  return result;
}

async function readSafeFocusedField({ selectionOnly = false, helperWindowHandle = "", helperProcessId = "", windowHandle = "", processId = "", pointX = "", pointY = "", pointScale = "" } = {}) {
  const result = await runSafePowerShell({
    ...baseEnvironment({ helperWindowHandle, helperProcessId, pointX, pointY, pointScale }),
    RADIMO_FIELD_SELECTION_ONLY: selectionOnly ? "true" : "false",
    RADIMO_FIELD_EXPECTED_WINDOW: String(windowHandle || ""),
    RADIMO_FIELD_EXPECTED_PROCESS: String(processId || ""),
  }, SAFE_READ_POWERSHELL, 12000);
  decodeBase64Result(result, "textBase64", "text");
  if (typeof result?.text === "string") result.hash = crypto.createHash("sha256").update(result.text, "utf8").digest("hex");
  return result;
}

async function writeSafeFocusedField({ text, target } = {}) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, verified: false, error: "empty-text", accessibility: "uia" };
  if (!target?.windowHandle) return { ok: false, verified: false, error: "no-target-window", accessibility: "uia" };
  if (target.supportsWrite === false) return { ok: false, verified: false, error: "target-read-only", accessibility: "uia" };
  if (text.length > 30000) return { ok: false, verified: false, error: "text-too-long", accessibility: "uia" };
  const result = await runSafePowerShell({
    ...targetEnvironment({ ...target, text }),
  }, SAFE_WRITE_POWERSHELL, 12000);
  decodeBase64Result(result, "actualTextBase64", "actualText");
  return result;
}

async function scanSafeFieldWindow({ windowHandle = "", target = null, helperWindowHandle = "", helperProcessId = "", profile, readValues = false } = {}) {
  const normalizedProfile = normalizeFieldMapperProfile(profile);
  const configBase64 = Buffer.from(JSON.stringify(normalizedProfile), "utf8").toString("base64");
  const result = await runSafePowerShell({
    ...baseEnvironment({ helperWindowHandle, helperProcessId }),
    RADIMO_FIELD_SCAN_WINDOW: String(windowHandle || target?.windowHandle || ""),
    RADIMO_FIELD_SCAN_PROCESS: String(target?.processId || ""),
    RADIMO_FIELD_MAPPER_CONFIG_B64: configBase64,
    RADIMO_FIELD_READ_VALUES: readValues ? "true" : "false",
  }, SAFE_SCAN_POWERSHELL, 12000);
  const fields = Array.isArray(result.fields) ? result.fields : result.fields ? [result.fields] : [];
  for (const field of fields) {
    if (Array.isArray(field.matches)) continue;
    field.matches = field.matches ? [field.matches] : [];
  }
  for (const field of fields) decodeBase64Result(field, "valueBase64", "value");
  if (result.fields) result.fields = fields;
  return result;
}

async function focusSafeMappedField({ windowHandle = "", target = null, helperWindowHandle = "", helperProcessId = "" } = {}) {
  const resolvedWindow = String(windowHandle || target?.windowHandle || "");
  if (!resolvedWindow) return { ok: false, verified: false, error: "no-target-window", accessibility: "uia" };
  return runSafePowerShell({
    ...baseEnvironment({ helperWindowHandle, helperProcessId }),
    RADIMO_FIELD_SCAN_WINDOW: resolvedWindow,
    RADIMO_FIELD_PROCESS: String(target?.processId || ""),
    RADIMO_FIELD_CONTROL_WINDOW: String(target?.controlWindowHandle || target?.nativeWindowHandle || ""),
    RADIMO_FIELD_RUNTIME_ID: String(target?.runtimeId || ""),
    RADIMO_FIELD_AUTOMATION_ID: String(target?.automationId || ""),
    RADIMO_FIELD_CONTROL_TYPE: String(target?.controlType || ""),
    RADIMO_FIELD_NAME: String(target?.name || target?.title || ""),
  }, SAFE_FOCUS_POWERSHELL, 10000);
}

module.exports = {
  readSafeFocusedField,
  writeSafeFocusedField,
  scanSafeFieldWindow,
  focusSafeMappedField,
};
