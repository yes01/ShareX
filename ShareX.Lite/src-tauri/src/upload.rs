use crate::settings::UploadTargetKind;
use crate::{AppError, AppResult};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    pub target_id: String,
    pub kind: UploadTargetKind,
    pub endpoint: Option<String>,
    pub method: Option<String>,
    pub directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub url: Option<String>,
    pub destination: String,
    pub status_code: Option<u16>,
}

pub async fn upload_file(path: &str, request: UploadRequest) -> AppResult<UploadResult> {
    match request.kind {
        UploadTargetKind::LocalFolder => copy_to_local_folder(path, request.directory).await,
        UploadTargetKind::CustomHttp => upload_custom_http(path, request).await,
        UploadTargetKind::S3Compatible => Err(AppError::Message(
            "S3 兼容上传已预留，将在下一轮实现。".to_string(),
        )),
        UploadTargetKind::Ftp => Err(AppError::Message(
            "FTP 上传已预留，将在下一轮实现。".to_string(),
        )),
        UploadTargetKind::Sftp => Err(AppError::Message(
            "SFTP 上传已预留，将在下一轮实现。".to_string(),
        )),
    }
}

async fn copy_to_local_folder(path: &str, directory: Option<String>) -> AppResult<UploadResult> {
    let source = Path::new(path);
    let directory = directory.map(PathBuf::from).unwrap_or_else(|| {
        source
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()
    });
    tokio::fs::create_dir_all(&directory).await?;
    let name = source
        .file_name()
        .ok_or_else(|| AppError::Message("源文件没有文件名。".to_string()))?;
    let destination = unique_destination(&directory.join(name)).await;
    tokio::fs::copy(source, &destination).await?;
    Ok(UploadResult {
        url: Some(format!("file://{}", destination.to_string_lossy())),
        destination: destination.to_string_lossy().to_string(),
        status_code: None,
    })
}

async fn upload_custom_http(path: &str, request: UploadRequest) -> AppResult<UploadResult> {
    let endpoint = request
        .endpoint
        .ok_or_else(|| AppError::Message("必须填写自定义 HTTP 端点地址。".to_string()))?;
    let method = request.method.unwrap_or_else(|| "POST".to_string());
    let source = path.to_string();
    let endpoint_for_thread = endpoint.clone();
    let response = tauri::async_runtime::spawn_blocking(move || {
        let file = std::fs::File::open(&source)?;
        let body = ureq::Body::builder()
            .mime_type("application/octet-stream")
            .reader(file);
        let request = match method.to_uppercase().as_str() {
            "PUT" => ureq::put(&endpoint_for_thread),
            "POST" => ureq::post(&endpoint_for_thread),
            other => {
                return Err(AppError::Message(format!(
                    "不支持的自定义 HTTP 请求方法：{other}"
                )));
            }
        };
        let mut response = request
            .send(body)
            .map_err(|error| AppError::Message(error.to_string()))?;
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .read_to_string()
            .map_err(|error| AppError::Message(error.to_string()))?;
        Ok::<_, AppError>((status, body))
    })
    .await
    .map_err(|error| AppError::Message(error.to_string()))??;
    let (status, body) = response;
    if !(200..300).contains(&status) {
        return Err(AppError::Message(format!(
            "上传失败，HTTP 状态码 {}：{}",
            status, body
        )));
    }

    Ok(UploadResult {
        url: extract_url(&body).or(Some(endpoint.clone())),
        destination: endpoint,
        status_code: Some(status),
    })
}

async fn unique_destination(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("upload");
    let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    let suffix = Utc::now().format("%Y%m%d%H%M%S");
    let file_name = if extension.is_empty() {
        format!("{stem}-{suffix}")
    } else {
        format!("{stem}-{suffix}.{extension}")
    };
    path.with_file_name(file_name)
}

fn extract_url(body: &str) -> Option<String> {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
        for key in ["url", "link", "downloadUrl", "publicUrl"] {
            if let Some(url) = json.get(key).and_then(|value| value.as_str()) {
                return Some(url.to_string());
            }
        }
    }
    body.split_whitespace()
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|part| part.trim_matches('"').to_string())
}
