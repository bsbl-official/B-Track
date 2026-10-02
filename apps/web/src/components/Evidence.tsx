import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { api } from "../api";
import { errorMessage, formatDateTime } from "../format";
import type { Attachment } from "../types";

// Keep in step with the API (routes/attachments.ts).
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const ALLOWED_TYPES = new Set([
  ...IMAGE_TYPES,
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.csv,.zip,.doc,.docx,.xls,.xlsx";

// Browsers leave the type empty for some files (e.g. .log); fall back on the extension.
const TYPE_BY_EXTENSION: Record<string, string> = { log: "text/plain", txt: "text/plain", csv: "text/csv" };
function withType(file: File): File {
  if (file.type) return file;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPE_BY_EXTENSION[extension];
  return type ? new File([file], file.name, { type }) : file;
}

export const isImage = (type: string) => IMAGE_TYPES.includes(type);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Why a file can't be attached, or null if it can. */
export function evidenceProblem(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) return `${file.name}: attach images, PDFs, text, CSV, Word, Excel or ZIP files`;
  if (file.size > MAX_EVIDENCE_BYTES) return `${file.name} is larger than ${formatSize(MAX_EVIDENCE_BYTES)}`;
  if (file.size === 0) return `${file.name} is empty`;
  return null;
}

// Pasted screenshots arrive as "image.png"; give them a findable name.
function namePasted(file: File, index: number): File {
  if (file.name && file.name !== "image.png") return file;
  // Local time, e.g. "Screenshot 2026-10-01 10-45-03.png".
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const extension = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1] || "png";
  return new File([file], `Screenshot ${stamp}${index ? ` (${index + 1})` : ""}.${extension}`, { type: file.type });
}

/** Files from a paste event (screenshots, copied files). Text pastes return nothing. */
export function filesFromPaste(event: { clipboardData: DataTransfer | null }): File[] {
  const files = [...(event.clipboardData?.files ?? [])];
  return files.map((file, index) => namePasted(withType(file), index));
}

function filesFromDrop(event: DragEvent): File[] {
  return [...event.dataTransfer.files].map(withType);
}

function FileIcon({ type }: { type: string }) {
  const label = type === "application/pdf" ? "PDF" : type.includes("sheet") || type.includes("excel") || type === "text/csv" ? "XLS" : type.includes("word") ? "DOC" : type.includes("zip") ? "ZIP" : "TXT";
  return <span className={`file-icon ${label.toLowerCase()}`} aria-hidden="true">{label}</span>;
}

/**
 * Drop zone + "browse" button. Paste is handled by the surrounding form or drawer (so Ctrl+V
 * works anywhere in it) and passed in through `onFiles` as well.
 */
function DropZone({ onFiles, hint }: { onFiles: (files: File[]) => void; hint: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`evidence-drop ${over ? "over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFiles(filesFromDrop(event));
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></svg>
      <div>
        <strong>
          Paste a screenshot (<kbd>Ctrl</kbd>+<kbd>V</kbd>), drop files here, or{" "}
          <button type="button" className="text-button" onClick={() => input.current?.click()}>browse</button>
        </strong>
        <span>{hint}</span>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])].map(withType));
          event.target.value = "";
        }}
      />
    </div>
  );
}

const HINT = `Images, PDF, text, CSV, Word, Excel or ZIP · up to ${formatSize(MAX_EVIDENCE_BYTES)} each`;

/** Files picked while creating a task; uploaded after the task is saved. */
export function EvidencePicker({ files, onChange, onProblem }: { files: File[]; onChange: (files: File[]) => void; onProblem: (message: string | null) => void }) {
  const previews = useMemo(() => files.map((file) => (isImage(file.type) ? URL.createObjectURL(file) : null)), [files]);
  useEffect(() => () => previews.forEach((url) => url && URL.revokeObjectURL(url)), [previews]);

  const add = (incoming: File[]) => {
    const problems = incoming.map(evidenceProblem).filter(Boolean);
    onProblem(problems.length ? problems.join(". ") : null);
    const accepted = incoming.filter((file) => !evidenceProblem(file));
    if (accepted.length) onChange([...files, ...accepted]);
  };

  return (
    <div className="evidence">
      <DropZone onFiles={add} hint={HINT} />
      {files.length > 0 && (
        <ul className="evidence-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="evidence-item">
              {previews[index] ? <img src={previews[index]!} alt="" /> : <FileIcon type={file.type} />}
              <span className="evidence-name" title={file.name}>{file.name}</span>
              <span className="evidence-size">{formatSize(file.size)}</span>
              <button type="button" className="evidence-remove" onClick={() => onChange(files.filter((_, position) => position !== index))} aria-label={`Remove ${file.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Evidence already on a task (task details drawer): view, add, remove. */
export function EvidenceGallery({
  taskId,
  attachments,
  canAdd,
  currentUserId,
  onChanged,
}: {
  taskId: string;
  attachments: Attachment[];
  canAdd: boolean;
  currentUserId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Ctrl+V anywhere while the task is open attaches a copied screenshot or file.
  const uploadRef = useRef<(files: File[]) => void>(() => undefined);
  useEffect(() => {
    if (!canAdd) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = filesFromPaste(event);
      if (!files.length) return;
      event.preventDefault();
      uploadRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [canAdd]);

  const upload = async (incoming: File[]) => {
    const problems = incoming.map(evidenceProblem).filter(Boolean) as string[];
    const accepted = incoming.filter((file) => !evidenceProblem(file));
    setBusy(true);
    for (const file of accepted) {
      try {
        await api.uploadAttachment(taskId, file);
      } catch (error) {
        problems.push(`${file.name}: ${errorMessage(error)}`);
      }
    }
    setBusy(false);
    setProblem(problems.length ? problems.join(". ") : null);
    if (accepted.length) onChanged();
  };

  uploadRef.current = upload;

  const remove = async (attachment: Attachment) => {
    if (!window.confirm(`Remove "${attachment.fileName}"?`)) return;
    try {
      await api.deleteAttachment(taskId, attachment.id);
      onChanged();
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  return (
    <div className="evidence">
      {attachments.length === 0 && !canAdd && <p className="drawer-empty">No evidence attached.</p>}
      {attachments.length > 0 && (
        <ul className="evidence-grid">
          {attachments.map((attachment) => {
            const url = api.attachmentUrl(taskId, attachment.id);
            return (
              <li key={attachment.id} className="evidence-card">
                <a href={url} target="_blank" rel="noreferrer" className="evidence-preview" title={`Open ${attachment.fileName}`}>
                  {isImage(attachment.mimeType) ? <img src={url} alt={attachment.fileName} loading="lazy" /> : <FileIcon type={attachment.mimeType} />}
                </a>
                <div className="evidence-meta">
                  <a href={url} target="_blank" rel="noreferrer" className="evidence-name" title={attachment.fileName}>{attachment.fileName}</a>
                  <span>{formatSize(attachment.size)} · {attachment.uploader.name} · {formatDateTime(attachment.createdAt)}</span>
                </div>
                <div className="evidence-actions">
                  <a href={api.attachmentUrl(taskId, attachment.id, true)} className="text-button" download>Download</a>
                  {(canAdd || attachment.uploader.id === currentUserId) && (
                    <button type="button" className="text-button danger-text" onClick={() => remove(attachment)}>Remove</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canAdd && <DropZone onFiles={upload} hint={busy ? "Uploading…" : HINT} />}
      {problem && <p className="form-error evidence-problem" role="alert">{problem}</p>}
    </div>
  );
}
