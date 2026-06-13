use crate::history::HistoryItem;
use crate::settings::{AppSettings, ImageFormat};
use crate::{AppError, AppResult};
use chrono::Utc;
use image::imageops::{FilterType, overlay};
use image::{DynamicImage, GenericImageView, ImageBuffer, Rgba};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessImageRequest {
    pub source_path: String,
    pub crop: Option<CropRect>,
    pub resize_width: Option<u32>,
    pub grayscale: bool,
    pub border: Option<BorderOptions>,
    pub watermark: Option<WatermarkOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderOptions {
    pub size: u32,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkOptions {
    pub text: String,
    pub position: WatermarkPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WatermarkPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

pub async fn process_image(
    request: ProcessImageRequest,
    settings: &AppSettings,
) -> AppResult<HistoryItem> {
    let source = PathBuf::from(&request.source_path);
    let output = build_processed_path(&source, settings)?;
    if let Some(parent) = output.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let output_for_thread = output.clone();
    tauri::async_runtime::spawn_blocking(move || process_image_sync(request, &output_for_thread))
        .await
        .map_err(|error| AppError::Message(error.to_string()))??;

    let metadata = tokio::fs::metadata(&output).await?;
    let dimensions = image::image_dimensions(&output).unwrap_or((0, 0));

    Ok(HistoryItem {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now(),
        kind: "image".to_string(),
        title: "截图后处理".to_string(),
        path: output.to_string_lossy().to_string(),
        url: None,
        status: "saved".to_string(),
        width: dimensions.0,
        height: dimensions.1,
        size_bytes: metadata.len(),
        error: None,
    })
}

fn process_image_sync(request: ProcessImageRequest, output: &Path) -> AppResult<()> {
    let mut image = image::open(&request.source_path)?;

    if let Some(crop) = request.crop {
        validate_crop(&image, &crop)?;
        image = image.crop_imm(crop.x, crop.y, crop.width, crop.height);
    }

    if let Some(width) = request.resize_width {
        if width > 0 && width < image.width() {
            let ratio = width as f32 / image.width() as f32;
            let height = ((image.height() as f32 * ratio).round() as u32).max(1);
            image = image.resize(width, height, FilterType::Lanczos3);
        }
    }

    if request.grayscale {
        image = image.grayscale();
    }

    if let Some(border) = request.border.filter(|border| border.size > 0) {
        image = add_border(image, border.size, parse_hex_color(&border.color)?);
    }

    if let Some(watermark) = request
        .watermark
        .filter(|watermark| !watermark.text.trim().is_empty())
    {
        image = add_watermark(image, &watermark);
    }

    image.save(output)?;
    Ok(())
}

fn validate_crop(image: &DynamicImage, crop: &CropRect) -> AppResult<()> {
    if crop.width == 0 || crop.height == 0 {
        return Err(AppError::Message("裁剪区域宽高必须大于 0。".to_string()));
    }
    if crop.x >= image.width()
        || crop.y >= image.height()
        || crop.x.saturating_add(crop.width) > image.width()
        || crop.y.saturating_add(crop.height) > image.height()
    {
        return Err(AppError::Message("裁剪区域超出了图片范围。".to_string()));
    }
    Ok(())
}

fn add_border(image: DynamicImage, size: u32, color: Rgba<u8>) -> DynamicImage {
    let (width, height) = image.dimensions();
    let mut canvas = ImageBuffer::from_pixel(width + size * 2, height + size * 2, color);
    overlay(&mut canvas, &image.to_rgba8(), size.into(), size.into());
    DynamicImage::ImageRgba8(canvas)
}

fn add_watermark(image: DynamicImage, watermark: &WatermarkOptions) -> DynamicImage {
    let mut canvas = image.to_rgba8();
    let label = watermark.text.trim();
    let scale = 2;
    let padding = 18;
    let width = label.chars().count() as u32 * 6 * scale;
    let height = 8 * scale;
    let (x, y) = match watermark.position {
        WatermarkPosition::TopLeft => (padding, padding),
        WatermarkPosition::TopRight => (canvas.width().saturating_sub(width + padding), padding),
        WatermarkPosition::BottomLeft => {
            (padding, canvas.height().saturating_sub(height + padding))
        }
        WatermarkPosition::BottomRight => (
            canvas.width().saturating_sub(width + padding),
            canvas.height().saturating_sub(height + padding),
        ),
    };

    draw_text(&mut canvas, label, x, y, scale, Rgba([255, 255, 255, 210]));
    draw_text(
        &mut canvas,
        label,
        x + 1,
        y + 1,
        scale,
        Rgba([0, 0, 0, 160]),
    );
    DynamicImage::ImageRgba8(canvas)
}

fn draw_text(
    image: &mut ImageBuffer<Rgba<u8>, Vec<u8>>,
    text: &str,
    start_x: u32,
    start_y: u32,
    scale: u32,
    color: Rgba<u8>,
) {
    let mut cursor = start_x;
    for ch in text.chars() {
        draw_char(image, ch, cursor, start_y, scale, color);
        cursor = cursor.saturating_add(6 * scale);
    }
}

fn draw_char(
    image: &mut ImageBuffer<Rgba<u8>, Vec<u8>>,
    ch: char,
    start_x: u32,
    start_y: u32,
    scale: u32,
    color: Rgba<u8>,
) {
    let glyph = glyph(ch);
    for (row, bits) in glyph.iter().enumerate() {
        for col in 0..5 {
            if bits & (1 << (4 - col)) == 0 {
                continue;
            }
            for dx in 0..scale {
                for dy in 0..scale {
                    let x = start_x + col * scale + dx;
                    let y = start_y + row as u32 * scale + dy;
                    if x < image.width() && y < image.height() {
                        blend_pixel(image, x, y, color);
                    }
                }
            }
        }
    }
}

fn blend_pixel(image: &mut ImageBuffer<Rgba<u8>, Vec<u8>>, x: u32, y: u32, color: Rgba<u8>) {
    let alpha = color[3] as f32 / 255.0;
    let pixel = image.get_pixel_mut(x, y);
    for channel in 0..3 {
        pixel[channel] = ((color[channel] as f32 * alpha) + (pixel[channel] as f32 * (1.0 - alpha)))
            .round() as u8;
    }
    pixel[3] = 255;
}

fn glyph(ch: char) -> [u32; 7] {
    match ch.to_ascii_uppercase() {
        'A' => [
            0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'B' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110,
        ],
        'C' => [
            0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111,
        ],
        'D' => [
            0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110,
        ],
        'E' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
        ],
        'F' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'G' => [
            0b01111, 0b10000, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111,
        ],
        'H' => [
            0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
        'I' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111,
        ],
        'J' => [
            0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100,
        ],
        'K' => [
            0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001,
        ],
        'L' => [
            0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111,
        ],
        'M' => [
            0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001,
        ],
        'N' => [
            0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001,
        ],
        'O' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'P' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
        'Q' => [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101,
        ],
        'R' => [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001,
        ],
        'S' => [
            0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
        'T' => [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'U' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
        'V' => [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100,
        ],
        'W' => [
            0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010,
        ],
        'X' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001,
        ],
        'Y' => [
            0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
        'Z' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111,
        ],
        '0' => [
            0b01110, 0b10011, 0b10101, 0b10101, 0b11001, 0b10001, 0b01110,
        ],
        '1' => [
            0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ],
        '2' => [
            0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111,
        ],
        '3' => [
            0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
        '4' => [
            0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010,
        ],
        '5' => [
            0b11111, 0b10000, 0b10000, 0b11110, 0b00001, 0b00001, 0b11110,
        ],
        '6' => [
            0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110,
        ],
        '7' => [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000,
        ],
        '8' => [
            0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110,
        ],
        '9' => [
            0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110,
        ],
        '-' => [
            0b00000, 0b00000, 0b00000, 0b01110, 0b00000, 0b00000, 0b00000,
        ],
        '_' => [
            0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111,
        ],
        ':' => [
            0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000,
        ],
        '.' => [
            0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100,
        ],
        '/' => [
            0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000,
        ],
        ' ' => [0; 7],
        _ => [
            0b11111, 0b10001, 0b00010, 0b00100, 0b00100, 0b00000, 0b00100,
        ],
    }
}

fn parse_hex_color(value: &str) -> AppResult<Rgba<u8>> {
    let value = value.trim().trim_start_matches('#');
    if value.len() != 6 {
        return Err(AppError::Message(
            "边框颜色必须是 #RRGGBB 格式。".to_string(),
        ));
    }
    let red = u8::from_str_radix(&value[0..2], 16)
        .map_err(|_| AppError::Message("边框颜色格式不正确。".to_string()))?;
    let green = u8::from_str_radix(&value[2..4], 16)
        .map_err(|_| AppError::Message("边框颜色格式不正确。".to_string()))?;
    let blue = u8::from_str_radix(&value[4..6], 16)
        .map_err(|_| AppError::Message("边框颜色格式不正确。".to_string()))?;
    Ok(Rgba([red, green, blue, 255]))
}

fn build_processed_path(source: &Path, settings: &AppSettings) -> AppResult<PathBuf> {
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let extension = match settings.image_format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
    };
    Ok(Path::new(&settings.save_directory).join(format!("{stem}-processed.{extension}")))
}
