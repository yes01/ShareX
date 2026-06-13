use crate::history::HistoryItem;
use crate::settings::{AppSettings, ImageFormat};
use crate::{AppError, AppResult};
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

pub async fn capture_all_monitors(settings: &AppSettings) -> AppResult<HistoryItem> {
    capture_to_file(None, "All monitors", settings).await
}

pub async fn capture_monitor(index: usize, settings: &AppSettings) -> AppResult<HistoryItem> {
    capture_to_file(Some(index), &format!("Monitor {}", index + 1), settings).await
}

pub async fn capture_active_monitor(settings: &AppSettings) -> AppResult<HistoryItem> {
    capture_monitor(0, settings).await
}

async fn capture_to_file(
    monitor_index: Option<usize>,
    title: &str,
    settings: &AppSettings,
) -> AppResult<HistoryItem> {
    let path = build_output_path(settings)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let path_for_thread = path.clone();
    tauri::async_runtime::spawn_blocking(move || capture_platform(monitor_index, &path_for_thread))
        .await
        .map_err(|error| AppError::Message(error.to_string()))??;

    let metadata = tokio::fs::metadata(&path).await?;
    let dimensions = image::image_dimensions(&path).unwrap_or((0, 0));

    Ok(HistoryItem {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now(),
        kind: "screenshot".to_string(),
        title: title.to_string(),
        path: path.to_string_lossy().to_string(),
        url: None,
        status: "saved".to_string(),
        width: dimensions.0,
        height: dimensions.1,
        size_bytes: metadata.len(),
        error: None,
    })
}

fn build_output_path(settings: &AppSettings) -> AppResult<PathBuf> {
    let now = Utc::now();
    let stem = now.format(&settings.filename_pattern).to_string();
    let extension = match settings.image_format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
    };
    let file_name = format!("{stem}.{extension}");
    Ok(Path::new(&settings.save_directory).join(file_name))
}

#[cfg(target_os = "macos")]
fn capture_platform(monitor_index: Option<usize>, path: &Path) -> AppResult<()> {
    let mut command = Command::new("screencapture");
    command.arg("-x");
    if let Some(index) = monitor_index {
        command.arg("-D").arg((index + 1).to_string());
    }
    command.arg(path);
    let output = command.output()?;
    if !output.status.success() {
        return Err(AppError::Message(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn capture_platform(monitor_index: Option<usize>, path: &Path) -> AppResult<()> {
    let path = path.to_string_lossy().replace('\'', "''");
    let index = monitor_index.unwrap_or(0);
    let script = format!(
        r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
if ({index} -ge $screens.Length) {{ throw 'Monitor index was not found.' }}
$bounds = if ($screens.Length -eq 1 -or {index} -ge 0) {{ $screens[{index}].Bounds }} else {{ [System.Windows.Forms.SystemInformation]::VirtualScreen }}
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('{path}')
$graphics.Dispose()
$bitmap.Dispose()
"#
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()?;
    if !output.status.success() {
        return Err(AppError::Message(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn capture_platform(_monitor_index: Option<usize>, _path: &Path) -> AppResult<()> {
    Err(AppError::Message(
        "Screen capture is only enabled for macOS and Windows builds.".to_string(),
    ))
}
