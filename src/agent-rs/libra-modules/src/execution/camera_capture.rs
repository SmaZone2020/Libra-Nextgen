use base64::Engine;

/// Camera capture — Windows-only.
/// Listing via PowerShell/WMI + SetupAPI FFI.
/// Capture via PowerShell WinRT MediaCapture.
pub struct CameraCapture;

impl CameraCapture {
    /// List available cameras as JSON array.
    /// Uses PowerShell WMI as primary, falls back to empty array.
    pub fn list_cameras() -> String {
        #[cfg(windows)]
        {
            if let Some(json) = ps_list_cameras() {
                return json;
            }
        }
        r#"{"cameras":[],"note":"Camera enumeration not supported on this platform"}"#.to_string()
    }

    /// Capture a single frame from the given camera index.
    /// Returns JSON with base64-encoded JPEG data.
    pub fn capture(camera_index: u32) -> String {
        #[cfg(windows)]
        {
            match ps_capture_frame(camera_index) {
                Ok(base64_jpeg) => format!(r#"{{"data":"{}"}}"#, base64_jpeg),
                Err(e) => format!(r#"{{"error":"{}"}}"#, e.replace('"', "'")),
            }
        }
        #[cfg(not(windows))]
        {
            r#"{"error":"Camera capture only supported on Windows"}"#.to_string()
        }
    }
}

#[cfg(windows)]
fn ps_list_cameras() -> Option<String> {
    use std::os::windows::process::CommandExt;

    // PowerShell script: enumerate PnP camera/image devices via CIM
    let script = r#"
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$cameras = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Camera' -or $_.PNPClass -eq 'Image' -or $_.Name -match 'camera|webcam|cam' })
$i = 0
$result = foreach ($cam in $cameras) {
    if ($cam.Caption -and $cam.Caption -notmatch '^root\\') {
        [PSCustomObject]@{ index = $i; name = $cam.Caption; characteristics = @() }
        $i++
    }
}
if ($result.Count -eq 0) { '[]' } else { @($result) | ConvertTo-Json -Compress }
"#;

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(0x08000000)
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() || stdout == "[]" {
        // Fall back to SetupAPI via another PS approach
        return ps_list_cameras_setupapi();
    }
    Some(stdout)
}

#[cfg(windows)]
fn ps_list_cameras_setupapi() -> Option<String> {
    use std::os::windows::process::CommandExt;

    // PowerShell fallback: get devices with PNPClass 'Image' or 'Camera', wider net
    let script = r#"
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$devices = @(Get-CimInstance Win32_PnPEntity | Where-Object {
    $_.Name -and ($_.PNPClass -eq 'Image' -or $_.PNPClass -eq 'Camera' -or $_.PNPDeviceID -match 'USB\\VID_' -or $_.Service -eq 'usbvideo')
})
$i = 0
$result = foreach ($d in $devices) {
    if ($d.Caption) {
        [PSCustomObject]@{ index = $i; name = $d.Caption; characteristics = @() }
        $i++
    }
}
if ($result.Count -eq 0) { '[]' } else { @($result) | ConvertTo-Json -Compress }
"#;

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(0x08000000)
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() { None } else { Some(stdout) }
}

#[cfg(windows)]
fn ps_capture_frame(camera_index: u32) -> Result<String, String> {
    use std::os::windows::process::CommandExt;

    // Use PowerShell to take a photo via Windows.Media.Capture WinRT API
    // Write temp JPEG path
    let temp_dir = std::env::temp_dir();
    let jpeg_path = temp_dir.join(format!("libra_cam_{}.jpg", std::process::id()));

    let script = format!(r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Load WinRT types for Media Capture
[Windows.Media.Capture.MediaCapture,Windows.Media,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Capture.MediaCaptureInitializationSettings,Windows.Media,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Capture.MediaCaptureVideoProfile,Windows.Media,ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Capture.CameraCaptureUIVideoCaptureMode,Windows.Media,ContentType=WindowsRuntime] | Out-Null

$capture = New-Object Windows.Media.Capture.MediaCapture
$settings = New-Object Windows.Media.Capture.MediaCaptureInitializationSettings

# Find the requested camera
$devices = @(Get-CimInstance Win32_PnPEntity | Where-Object {{ $_.PNPClass -eq 'Camera' -or $_.PNPClass -eq 'Image' }})
if ({0} -ge $devices.Count) {{
    Write-Error "Camera index {0} out of range"
    exit 1
}}

$settings.VideoDeviceId = $devices[{0}].DeviceID

$task = $capture.InitializeAsync($settings)
$task.GetAwaiter().GetResult()

# Take photo
$file = [Windows.Storage.StorageFile]::GetFileFromPathAsync("{1}").GetAwaiter().GetResult()
$props = [Windows.Media.MediaProperties.ImageEncodingProperties]::CreateJpeg()
$task2 = $capture.CapturePhotoToStorageFileAsync($props, $file)
$task2.GetAwaiter().GetResult()

Write-Output "OK"
"#, camera_index, jpeg_path.display());

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    if output.status.success() {
        if let Ok(jpeg_data) = std::fs::read(&jpeg_path) {
            let _ = std::fs::remove_file(&jpeg_path);
            if !jpeg_data.is_empty() {
                return Ok(base64::engine::general_purpose::STANDARD.encode(&jpeg_data));
            }
        }
        Err("Camera captured empty frame".into())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let _ = std::fs::remove_file(&jpeg_path);
        Err(format!("Camera capture failed: {} {}", stdout.trim(), stderr.trim()).trim().to_string())
    }
}
