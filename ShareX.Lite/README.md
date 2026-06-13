# ShareX Lite

ShareX Lite is a Rust + Tauri rewrite scaffold for the first required feature set:

- Fullscreen, monitor, active-monitor, and region capture workflow
- Image history with save, reveal, upload, and copy URL actions
- After-capture pipeline settings
- Upload target settings for local folder and custom HTTP
- Reserved target contracts for S3 compatible storage, FTP, and SFTP
- Tray menu, notifications, clipboard, and global shortcut permissions
- GitHub Actions packaging for Windows x64 and macOS Apple Silicon

## Development

```bash
npm install
npm run tauri:dev
```

## Build

```bash
npm run tauri:build
```

On macOS, the verified first-pass bundle is the `.app` package. DMG generation can be enabled later once signing/notarization and the current macOS `create-dmg` behavior are settled.

## Current Implementation Notes

The first pass includes monitor screenshot capture through `xcap`, local history, local-folder upload, and custom HTTP multipart upload. Region capture, image-copy clipboard wiring, S3, FTP, and SFTP are intentionally scaffolded as module contracts for the next platform-specific implementation pass.
