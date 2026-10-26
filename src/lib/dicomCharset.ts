import type { DicomDataSet } from "dicom-parser";

/**
 * DICOM SpecificCharacterSet (0008,0005) desteği. dicom-parser metni Latin-1 gibi okur; Türkçe karakterli
 * UTF-8 (ISO_IR 192) ve Latin-5 (ISO_IR 148) etiketleri bu yüzden bozulurdu. Burada DataSet.string(),
 * karakter kümesi tanımlı dosyalarda ham baytları doğru kodlamayla çözecek şekilde sarılır.
 * Kapsam: tek baytlı ISO 8859 aileleri, UTF-8, GB18030/GBK. ISO 2022 (çok kümeli) desteklenmez → eski davranış.
 */
const LABELS: Record<string, string> = {
  "ISO_IR 100": "iso-8859-1", "ISO_IR 101": "iso-8859-2", "ISO_IR 109": "iso-8859-3", "ISO_IR 110": "iso-8859-4",
  "ISO_IR 144": "iso-8859-5", "ISO_IR 127": "iso-8859-6", "ISO_IR 126": "iso-8859-7", "ISO_IR 138": "iso-8859-8",
  "ISO_IR 148": "iso-8859-9", "ISO_IR 166": "windows-874", "ISO_IR 192": "utf-8", GB18030: "gb18030", GBK: "gbk",
};

const charsetOf = new WeakMap<Uint8Array, string>();
const decoders = new Map<string, TextDecoder>();
const decoder = (label: string) => { let d = decoders.get(label); if (!d) { d = new TextDecoder(label, { fatal: false }); decoders.set(label, d); } return d; };

type StringFn = (this: DicomDataSet, tag: string, index?: number) => string | undefined;
let patched = false;

function patch(ds: DicomDataSet) {
  if (patched) return;
  const proto = Object.getPrototypeOf(ds) as { string: StringFn };
  const orig = proto.string;
  proto.string = function (this: DicomDataSet, tag: string, index?: number) {
    const label = charsetOf.get(this.byteArray);
    if (label) {
      const el = this.elements[tag];
      if (el && el.length > 0 && !el.items && !el.fragments) {
        const bytes = this.byteArray.subarray(el.dataOffset, el.dataOffset + el.length);
        let high = false;
        for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { high = true; break; }
        if (high) {
          let text = decoder(label).decode(bytes);
          const nul = text.indexOf("\0");
          if (nul >= 0) text = text.slice(0, nul);
          if (index !== undefined && index >= 0) return text.split("\\")[index]?.trim();
          return text.trim();
        }
      }
    }
    return orig.call(this, tag, index);
  };
  patched = true;
}

/** Ayrıştırılmış veri kümesine karakter kümesi çözümlemesini uygular (gerekmiyorsa dokunmaz). */
export function applyCharset(ds: DicomDataSet): DicomDataSet {
  const raw = ds.string("x00080005");
  if (!raw) return ds;
  // çok değerli ise (ör. "\ISO 2022 IR 87") ilk dolu değer; ISO 2022 içerenler desteklenmez
  if (/ISO 2022/i.test(raw)) return ds;
  const first = raw.split("\\").map((v) => v.trim()).find((v) => v) ?? "";
  const label = LABELS[first.toUpperCase()] ?? LABELS[first];
  if (!label) return ds;
  patch(ds);
  charsetOf.set(ds.byteArray, label);
  return ds;
}
