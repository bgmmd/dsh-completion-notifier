param(
  [string]$TitleB64 = '',
  [string]$BodyB64 = '',
  [string]$Aumid = 'com.deepseek.dsh',
  [string]$SoundPath = '',
  [string]$SoundFallbackPath = '',
  [int]$MuteToastSound = 1,
  [int]$Toast = 1,
  [string]$LogPath = ''
)

# Helper for the completion-notifier host plugin.
# Receives UTF-8 values as base64 so Chinese text survives the PowerShell
# command line, shows a Windows toast (WinRT, tray-balloon fallback), plays a
# short chime, and optionally appends a JSON result line to -LogPath.

$ErrorActionPreference = 'Stop'

function Decode-B64([string]$value) {
  if ([string]::IsNullOrEmpty($value)) { return '' }
  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($value))
}

$title = Decode-B64 $TitleB64
$body = Decode-B64 $BodyB64
if ([string]::IsNullOrWhiteSpace($title)) { $title = 'Task complete' }
if ([string]::IsNullOrWhiteSpace($body)) { $body = 'Conversation finished.' }

$result = [ordered]@{
  ts = (Get-Date).ToString('o')
  toast = 'skipped'
  sound = 'skipped'
  error = ''
}

# --- Windows toast -------------------------------------------------------
if ($Toast -eq 1) {
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $xml.GetElementsByTagName('text')
    $texts.Item(0).AppendChild($xml.CreateTextNode($title)) | Out-Null
    $texts.Item(1).AppendChild($xml.CreateTextNode($body)) | Out-Null
    if ($MuteToastSound -eq 1) {
      $audio = $xml.CreateElement('audio')
      $audio.SetAttribute('silent', 'true')
      $xml.DocumentElement.AppendChild($audio) | Out-Null
    }
    $toastNotification = New-Object Windows.UI.Notifications.ToastNotification $xml
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid)
    $notifier.Show($toastNotification)
    $result.toast = 'winrt'
  } catch {
    $toastError = $_.Exception.Message
    try {
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $notifyIcon = New-Object System.Windows.Forms.NotifyIcon
      $notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
      $notifyIcon.BalloonTipTitle = $title
      $notifyIcon.BalloonTipText = $body
      $notifyIcon.Visible = $true
      $notifyIcon.ShowBalloonTip(8000)
      Start-Sleep -Milliseconds 600
      $result.toast = 'balloon'
      Start-Sleep -Seconds 8
      $notifyIcon.Visible = $false
      $notifyIcon.Dispose()
    } catch {
      $result.error = 'toast: ' + $toastError + ' | balloon: ' + $_.Exception.Message
    }
  }
}

# --- chime --------------------------------------------------------------
if ($SoundPath -ne '') {
  $chosen = $SoundPath
  if (-not (Test-Path -LiteralPath $chosen)) {
    $result.error = ($result.error + ' | sound: missing ' + $chosen).Trim(' |')
    $chosen = ''
  }
  if ($chosen -eq '' -and $SoundFallbackPath -ne '' -and (Test-Path -LiteralPath $SoundFallbackPath)) {
    $chosen = $SoundFallbackPath
  }
  if ($chosen -ne '') {
    try {
      $player = New-Object System.Media.SoundPlayer $chosen
      $player.PlaySync()
      $result.sound = 'ok'
    } catch {
      $result.sound = 'fail'
      $result.error = ($result.error + ' | sound: ' + $_.Exception.Message).Trim(' |')
    }
  }
}

# --- optional result log ------------------------------------------------
if ($LogPath -ne '') {
  try {
    ($result | ConvertTo-Json -Compress) | Add-Content -LiteralPath $LogPath -Encoding UTF8
  } catch {
  }
}

$result | ConvertTo-Json -Compress
