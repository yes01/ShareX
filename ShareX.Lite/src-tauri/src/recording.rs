use crate::history::HistoryItem;
use crate::settings::{AppSettings, RecordingSettings};
use crate::{AppError, AppResult};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingRequest {
    pub mode: RecordingMode,
    pub duration_seconds: u32,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordingMode {
    Screen,
    Gif,
}

pub async fn record_screen(
    request: RecordingRequest,
    settings: &AppSettings,
) -> AppResult<HistoryItem> {
    let request = normalize_request(request, &settings.recording);
    let output = build_recording_path(settings, &request)?;
    if let Some(parent) = output.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let output_for_thread = output.clone();
    let request_for_thread = request.clone();
    tauri::async_runtime::spawn_blocking(move || {
        record_platform(&request_for_thread, &output_for_thread)
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))??;

    let metadata = tokio::fs::metadata(&output).await?;
    Ok(HistoryItem {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now(),
        kind: match request.mode {
            RecordingMode::Screen => "video".to_string(),
            RecordingMode::Gif => "gif".to_string(),
        },
        title: match request.mode {
            RecordingMode::Screen => "录屏".to_string(),
            RecordingMode::Gif => "GIF 录制".to_string(),
        },
        path: output.to_string_lossy().to_string(),
        url: None,
        status: "saved".to_string(),
        width: 0,
        height: 0,
        size_bytes: metadata.len(),
        error: None,
    })
}

fn normalize_request(
    mut request: RecordingRequest,
    settings: &RecordingSettings,
) -> RecordingRequest {
    if request.duration_seconds == 0 {
        request.duration_seconds = settings.duration_seconds;
    }
    if request.fps == 0 {
        request.fps = settings.fps;
    }
    request.duration_seconds = request.duration_seconds.clamp(1, 600);
    request.fps = request.fps.clamp(1, 60);
    request
}

fn build_recording_path(settings: &AppSettings, request: &RecordingRequest) -> AppResult<PathBuf> {
    let stem = Utc::now()
        .format(&settings.recording.filename_pattern)
        .to_string();
    let extension = match request.mode {
        RecordingMode::Screen => "mp4",
        RecordingMode::Gif => "gif",
    };
    Ok(Path::new(&settings.save_directory).join(format!("{stem}.{extension}")))
}

#[cfg(target_os = "macos")]
fn record_platform(request: &RecordingRequest, output: &Path) -> AppResult<()> {
    let temp_mov = match request.mode {
        RecordingMode::Screen => None,
        RecordingMode::Gif => Some(output.with_extension("mov")),
    };
    let capture_path = temp_mov.as_deref().unwrap_or(output);
    let output_text = capture_path.to_string_lossy().to_string();

    let status = Command::new("screencapture")
        .args([
            "-v",
            "-x",
            "-V",
            &request.duration_seconds.to_string(),
            &output_text,
        ])
        .status()?;
    if !status.success() {
        return Err(AppError::Message(
            "macOS 录屏失败，请确认已授权屏幕录制权限。".to_string(),
        ));
    }

    if matches!(request.mode, RecordingMode::Gif) {
        convert_video_to_gif(capture_path, output, request.fps)?;
        if let Some(temp) = temp_mov {
            let _ = std::fs::remove_file(temp);
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn record_platform(request: &RecordingRequest, output: &Path) -> AppResult<()> {
    ensure_ffmpeg()?;
    let mut command = Command::new("ffmpeg");
    command.args([
        "-y",
        "-f",
        "gdigrab",
        "-framerate",
        &request.fps.to_string(),
        "-t",
        &request.duration_seconds.to_string(),
        "-i",
        "desktop",
    ]);

    match request.mode {
        RecordingMode::Screen => {
            command.args(["-pix_fmt", "yuv420p"]);
            command.arg(output);
        }
        RecordingMode::Gif => {
            command.args([
                "-vf",
                &format!("fps={},scale=960:-1:flags=lanczos", request.fps),
            ]);
            command.arg(output);
        }
    }

    run_command(command, "Windows 录屏失败，请确认 ffmpeg 可用。")
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn record_platform(_request: &RecordingRequest, _output: &Path) -> AppResult<()> {
    Err(AppError::Message(
        "录屏目前仅支持 macOS 和 Windows 构建。".to_string(),
    ))
}

fn convert_video_to_gif(input: &Path, output: &Path, fps: u32) -> AppResult<()> {
    ensure_ffmpeg()?;
    let mut command = Command::new("ffmpeg");
    command.args([
        "-y",
        "-i",
        &input.to_string_lossy(),
        "-vf",
        &format!("fps={fps},scale=960:-1:flags=lanczos"),
        &output.to_string_lossy(),
    ]);
    run_command(command, "GIF 转换失败，请确认 ffmpeg 可用。")
}

fn ensure_ffmpeg() -> AppResult<()> {
    let status = Command::new("ffmpeg").arg("-version").status();
    match status {
        Ok(status) if status.success() => Ok(()),
        _ => Err(AppError::Message(
            "需要安装 ffmpeg 后才能录制 GIF 或在 Windows 上录屏。".to_string(),
        )),
    }
}

fn run_command(mut command: Command, message: &str) -> AppResult<()> {
    let output = command.output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Message(if stderr.is_empty() {
            message.to_string()
        } else {
            format!("{message} {stderr}")
        }));
    }
    Ok(())
}
