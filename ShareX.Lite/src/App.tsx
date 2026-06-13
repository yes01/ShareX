import {
  ArrowClockwise,
  Clipboard,
  Copy,
  FolderOpen,
  GearSix,
  Globe,
  HardDrives,
  ImageSquare,
  Monitor,
  PaperPlaneTilt,
  Selection,
  Sidebar,
  Trash,
  UploadSimple
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, AppSettings, HistoryItem, UploadTargetSettings } from "./tauri";

type View = "capture" | "history" | "upload" | "settings";

const formatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function App() {
  const [view, setView] = useState<View>("capture");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("Ready");
  const [error, setError] = useState<string | null>(null);

  const enabledTargets = useMemo(
    () => settings?.uploadTargets.filter((target) => target.enabled) ?? [],
    [settings]
  );
  const defaultTarget = enabledTargets[0] ?? null;

  const refresh = useCallback(async () => {
    const [nextSettings, nextHistory] = await Promise.all([api.getSettings(), api.listHistory()]);
    setSettings(nextSettings);
    setHistory(nextHistory);
  }, []);

  useEffect(() => {
    refresh().catch((reason) => setError(String(reason)));
  }, [refresh]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    api.onHistoryUpdated((item) => {
      setHistory((items) => [item, ...items.filter((current) => current.id !== item.id)]);
      setMessage(`${item.title} saved`);
    }).then((unsub) => unsubs.push(unsub));
    api.onTrayCaptureRequested(() => {
      void runCapture("all");
    }).then((unsub) => unsubs.push(unsub));
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  async function runCapture(mode: "all" | "active" | "region") {
    setBusy(mode);
    setError(null);
    try {
      if (mode === "region") {
        throw new Error("Region capture UI is scaffolded and ready for the next platform overlay pass.");
      }
      const item = mode === "active" ? await api.captureActiveMonitor() : await api.captureAll();
      setHistory((items) => [item, ...items.filter((current) => current.id !== item.id)]);
      setMessage(`${item.title} saved to ${shortPath(item.path)}`);
      await api.notify("Screenshot saved", item.title);
      if (settings?.afterCapture.upload && defaultTarget) {
        await runUpload(item, defaultTarget);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function runUpload(item: HistoryItem, target: UploadTargetSettings) {
    setBusy(`upload-${item.id}`);
    setError(null);
    try {
      const result = await api.uploadHistoryItem(item.id, {
        targetId: target.id,
        kind: target.kind,
        endpoint: target.endpoint,
        method: target.method,
        directory: target.directory
      });
      if (result.url) {
        await api.copyText(result.url);
      }
      setMessage(result.url ? `Uploaded and copied URL` : `Uploaded to ${target.name}`);
      await refresh();
    } catch (reason) {
      setError(String(reason));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(next: AppSettings) {
    setSettings(next);
    await api.saveSettings(next);
    setMessage("Settings saved");
  }

  const latest = history[0] ?? null;

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="brandMark">SX</div>
          <div>
            <strong>ShareX Lite</strong>
            <span>Rust + Tauri</span>
          </div>
        </div>

        <nav className="nav">
          <NavButton active={view === "capture"} icon={<Monitor />} label="Capture" onClick={() => setView("capture")} />
          <NavButton active={view === "history"} icon={<ImageSquare />} label="History" onClick={() => setView("history")} />
          <NavButton active={view === "upload"} icon={<UploadSimple />} label="Upload" onClick={() => setView("upload")} />
          <NavButton active={view === "settings"} icon={<GearSix />} label="Settings" onClick={() => setView("settings")} />
        </nav>

        <div className="railStatus">
          <span>Status</span>
          <strong>{message}</strong>
          {error ? <p>{error}</p> : null}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{titleForView(view)}</h1>
            <p>{subtitleForView(view)}</p>
          </div>
          <div className="topActions">
            <button className="secondaryButton" onClick={() => api.openScreenshotsFolder()}>
              <FolderOpen weight="bold" />
              Open folder
            </button>
            <button className="primaryButton" disabled={busy !== null} onClick={() => runCapture("all")}>
              <Monitor weight="bold" />
              Capture
            </button>
          </div>
        </header>

        {view === "capture" && (
          <CaptureView
            busy={busy}
            latest={latest}
            targets={enabledTargets}
            onCapture={runCapture}
            onUpload={runUpload}
          />
        )}
        {view === "history" && (
          <HistoryView
            busy={busy}
            history={history}
            targets={enabledTargets}
            onUpload={runUpload}
            onReveal={(path) => api.revealFile(path)}
            onCopy={(text) => api.copyText(text)}
            onClear={async () => {
              await api.clearHistory();
              setHistory([]);
              setMessage("History cleared");
            }}
          />
        )}
        {view === "upload" && settings && (
          <UploadView
            settings={settings}
            onSave={saveSettings}
          />
        )}
        {view === "settings" && settings && (
          <SettingsView
            settings={settings}
            onSave={saveSettings}
          />
        )}
      </section>
    </main>
  );
}

function CaptureView({
  busy,
  latest,
  targets,
  onCapture,
  onUpload
}: {
  busy: string | null;
  latest: HistoryItem | null;
  targets: UploadTargetSettings[];
  onCapture: (mode: "all" | "active" | "region") => void;
  onUpload: (item: HistoryItem, target: UploadTargetSettings) => void;
}) {
  return (
    <div className="gridLayout">
      <section className="panel commandPanel">
        <ActionTile
          icon={<Monitor />}
          title="Capture all monitors"
          body="Save the current desktop to history."
          disabled={busy !== null}
          active={busy === "all"}
          onClick={() => onCapture("all")}
        />
        <ActionTile
          icon={<Sidebar />}
          title="Capture active monitor"
          body="Use the primary monitor for the first pass."
          disabled={busy !== null}
          active={busy === "active"}
          onClick={() => onCapture("active")}
        />
        <ActionTile
          icon={<Selection />}
          title="Capture region"
          body="Reserved for the platform overlay."
          disabled={busy !== null}
          active={busy === "region"}
          onClick={() => onCapture("region")}
        />
      </section>

      <section className="panel latestPanel">
        <PanelHeader title="Latest capture" action={latest ? `${latest.width} x ${latest.height}` : "Empty"} />
        {latest ? (
          <div className="latestMeta">
            <div>
              <strong>{latest.title}</strong>
              <span>{shortPath(latest.path)}</span>
            </div>
            <div className="buttonRow">
              {targets[0] ? (
                <button className="secondaryButton" onClick={() => onUpload(latest, targets[0])}>
                  <PaperPlaneTilt weight="bold" />
                  Upload
                </button>
              ) : null}
              <button className="secondaryButton" onClick={() => api.revealFile(latest.path)}>
                <FolderOpen weight="bold" />
                Reveal
              </button>
            </div>
          </div>
        ) : (
          <EmptyState title="No captures yet" body="Use Capture all monitors to create the first history item." />
        )}
      </section>
    </div>
  );
}

function HistoryView({
  busy,
  history,
  targets,
  onUpload,
  onReveal,
  onCopy,
  onClear
}: {
  busy: string | null;
  history: HistoryItem[];
  targets: UploadTargetSettings[];
  onUpload: (item: HistoryItem, target: UploadTargetSettings) => void;
  onReveal: (path: string) => void;
  onCopy: (text: string) => void;
  onClear: () => void;
}) {
  return (
    <section className="panel">
      <PanelHeader
        title="Recent tasks"
        action={
          <button className="ghostButton" disabled={history.length === 0} onClick={onClear}>
            <Trash />
            Clear
          </button>
        }
      />
      {history.length === 0 ? (
        <EmptyState title="History is empty" body="Captured files and upload results will appear here." />
      ) : (
        <div className="historyList">
          {history.map((item) => (
            <article className="historyItem" key={item.id}>
              <div className={`statusDot ${item.status}`} />
              <div className="historyMain">
                <strong>{item.title}</strong>
                <span>{formatter.format(new Date(item.createdAt))} · {formatBytes(item.sizeBytes)} · {shortPath(item.path)}</span>
                {item.url ? <button className="linkButton" onClick={() => onCopy(item.url ?? "")}>{item.url}</button> : null}
                {item.error ? <p className="errorText">{item.error}</p> : null}
              </div>
              <div className="rowActions">
                {targets[0] ? (
                  <button
                    className="iconButton"
                    title="Upload"
                    disabled={busy === `upload-${item.id}`}
                    onClick={() => onUpload(item, targets[0])}
                  >
                    <UploadSimple />
                  </button>
                ) : null}
                <button className="iconButton" title="Reveal file" onClick={() => onReveal(item.path)}>
                  <FolderOpen />
                </button>
                {item.url ? (
                  <button className="iconButton" title="Copy URL" onClick={() => onCopy(item.url ?? "")}>
                    <Copy />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function UploadView({ settings, onSave }: { settings: AppSettings; onSave: (settings: AppSettings) => void }) {
  function updateTarget(index: number, patch: Partial<UploadTargetSettings>) {
    const uploadTargets = settings.uploadTargets.map((target, currentIndex) =>
      currentIndex === index ? { ...target, ...patch } : target
    );
    onSave({ ...settings, uploadTargets });
  }

  return (
    <section className="panel">
      <PanelHeader title="Upload targets" action={`${settings.uploadTargets.length} configured`} />
      <div className="targetGrid">
        {settings.uploadTargets.map((target, index) => (
          <div className="targetItem" key={target.id}>
            <div className="targetHead">
              <div className="targetIcon">{iconForTarget(target.kind)}</div>
              <div>
                <strong>{target.name}</strong>
                <span>{target.kind}</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={target.enabled}
                  onChange={(event) => updateTarget(index, { enabled: event.target.checked })}
                />
                <span />
              </label>
            </div>
            {target.kind === "LocalFolder" ? (
              <LabeledInput
                label="Directory"
                value={target.directory ?? ""}
                placeholder="Leave empty to copy beside source"
                onChange={(directory) => updateTarget(index, { directory })}
              />
            ) : (
              <>
                <LabeledInput
                  label="Endpoint"
                  value={target.endpoint ?? ""}
                  placeholder="https://example.com/upload"
                  onChange={(endpoint) => updateTarget(index, { endpoint })}
                />
                <LabeledInput
                  label="Method"
                  value={target.method ?? "POST"}
                  placeholder="POST"
                  onChange={(method) => updateTarget(index, { method })}
                />
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsView({ settings, onSave }: { settings: AppSettings; onSave: (settings: AppSettings) => void }) {
  return (
    <div className="settingsGrid">
      <section className="panel">
        <PanelHeader title="Capture output" action="Required" />
        <LabeledInput
          label="Save directory"
          value={settings.saveDirectory}
          onChange={(saveDirectory) => onSave({ ...settings, saveDirectory })}
        />
        <LabeledInput
          label="Filename pattern"
          value={settings.filenamePattern}
          onChange={(filenamePattern) => onSave({ ...settings, filenamePattern })}
        />
        <label className="field">
          <span>Image format</span>
          <select
            value={settings.imageFormat}
            onChange={(event) => onSave({ ...settings, imageFormat: event.target.value as AppSettings["imageFormat"] })}
          >
            <option value="Png">PNG</option>
            <option value="Jpeg">JPEG</option>
          </select>
        </label>
      </section>

      <section className="panel">
        <PanelHeader title="After capture" action="Pipeline" />
        <ToggleRow
          label="Copy image"
          checked={settings.afterCapture.copyImage}
          onChange={(copyImage) => onSave({ ...settings, afterCapture: { ...settings.afterCapture, copyImage } })}
        />
        <ToggleRow
          label="Save file"
          checked={settings.afterCapture.saveFile}
          onChange={(saveFile) => onSave({ ...settings, afterCapture: { ...settings.afterCapture, saveFile } })}
        />
        <ToggleRow
          label="Upload automatically"
          checked={settings.afterCapture.upload}
          onChange={(upload) => onSave({ ...settings, afterCapture: { ...settings.afterCapture, upload } })}
        />
      </section>

      <section className="panel">
        <PanelHeader title="Shortcuts" action="Global" />
        <LabeledInput
          label="Capture all"
          value={settings.shortcuts.captureAll}
          onChange={(captureAll) => onSave({ ...settings, shortcuts: { ...settings.shortcuts, captureAll } })}
        />
        <LabeledInput
          label="Capture region"
          value={settings.shortcuts.captureRegion}
          onChange={(captureRegion) => onSave({ ...settings, shortcuts: { ...settings.shortcuts, captureRegion } })}
        />
        <LabeledInput
          label="Upload clipboard"
          value={settings.shortcuts.uploadClipboard}
          onChange={(uploadClipboard) => onSave({ ...settings, shortcuts: { ...settings.shortcuts, uploadClipboard } })}
        />
      </section>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "navButton active" : "navButton"} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function ActionTile({
  icon,
  title,
  body,
  active,
  disabled,
  onClick
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button className="actionTile" disabled={disabled} onClick={onClick}>
      <span className="tileIcon">{active ? <ArrowClockwise className="spin" /> : icon}</span>
      <strong>{title}</strong>
      <span>{body}</span>
    </button>
  );
}

function PanelHeader({ title, action }: { title: string; action: React.ReactNode }) {
  return (
    <div className="panelHeader">
      <h2>{title}</h2>
      <div>{action}</div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="emptyState">
      <Clipboard size={30} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggleRow">
      <span>{label}</span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span />
      </span>
    </label>
  );
}

function titleForView(view: View) {
  return {
    capture: "Capture",
    history: "History",
    upload: "Upload",
    settings: "Settings"
  }[view];
}

function subtitleForView(view: View) {
  return {
    capture: "Fast capture, save, and upload actions for the first cross-platform pass.",
    history: "Saved screenshots, upload status, copied URLs, and local file actions.",
    upload: "Local and custom HTTP targets are active; S3, FTP, and SFTP are reserved.",
    settings: "Capture naming, output format, pipeline behavior, and shortcut mapping."
  }[view];
}

function iconForTarget(kind: string) {
  if (kind === "LocalFolder") return <HardDrives />;
  if (kind === "CustomHttp") return <Globe />;
  return <UploadSimple />;
}

function shortPath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts.length > 2 ? `${parts.at(-2)}/${parts.at(-1)}` : normalized;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default App;
