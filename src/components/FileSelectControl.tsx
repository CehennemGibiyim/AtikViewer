"use client";

import { useRef, useState, type ChangeEvent } from "react";

interface DirectoryHandle {
  kind: "directory";
  values(): AsyncIterableIterator<FileSystemFileHandle | DirectoryHandle>;
}
interface FileSystemFileHandle {
  kind: "file";
  getFile(): Promise<File>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" }) => Promise<DirectoryHandle>;
};

async function readDirectory(handle: DirectoryHandle, onCount: (n: number) => void, out: File[] = []): Promise<File[]> {
  for await (const entry of handle.values()) {
    if (entry.kind === "file") {
      out.push(await entry.getFile());
      if (out.length === 1 || out.length % 25 === 0) onCount(out.length);
    } else {
      await readDirectory(entry, onCount, out);
    }
  }
  return out;
}

/**
 * Top-level Chromium: File System Access API (alt klasörleri garantili dolaşır).
 * Gömülü önizleme / Firefox / Safari: webkitdirectory klasik seçicisi.
 * Görünür düğme gerçek bir button'dır; saydam katman tıklama yakalamaz.
 */
export default function FileSelectControl({ directory = false, onFiles }: { directory?: boolean; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [scanCount, setScanCount] = useState<number | null>(null);
  const label = directory ? "Klasör aç" : "Dosya aç";

  const changed = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = "";
    onFiles(files);
  };

  const open = async () => {
    if (!directory) { input.current?.click(); return; }
    let framed = false;
    try { framed = window.self !== window.top; } catch { framed = true; }
    const picker = (window as PickerWindow).showDirectoryPicker;
    // showDirectoryPicker çapraz köken iframe'de yasaktır. Kullanıcı aktivasyonunu kaybetmeden doğrudan fallback'e git.
    if (!framed && picker) {
      try {
        setScanCount(0);
        const handle = await picker({ mode: "read" });
        const files = await readDirectory(handle, setScanCount);
        setScanCount(null);
        onFiles(files);
        return;
      } catch (e) {
        setScanCount(null);
        if (e instanceof DOMException && e.name === "AbortError") return; // kullanıcı iptal etti
        // API engellendiyse klasik seçici; await sonrası aktivasyon bitebilir, kullanıcı ikinci kez tıklayabilir.
      }
    }
    input.current?.click();
  };

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        title={directory ? "Klasörü ve tüm alt klasörlerini tara" : "DICOM veya görüntü dosyalarını seç; uzantı kısıtı yok"}
        disabled={scanCount !== null}
        onClick={() => void open()}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:opacity-60 ${directory ? "border border-cyan-400/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20" : "bg-cyan-500 text-[#06131a] hover:bg-cyan-400"}`}
      >
        <span aria-hidden="true">{directory ? "📁" : "📄"}</span>
        <span>{scanCount === null ? label : `Klasör taranıyor… ${scanCount}`}</span>
      </button>
      <input
        ref={input}
        tabIndex={-1}
        aria-hidden="true"
        type="file"
        multiple
        {...(directory ? { webkitdirectory: "", directory: "" } : {})}
        className="hidden"
        onChange={changed}
      />
    </span>
  );
}
