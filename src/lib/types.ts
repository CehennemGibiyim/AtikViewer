export type Severity = "kritik" | "yuksek" | "orta" | "dusuk" | "normal";

export type Role = "yonetici" | "radyolog" | "teknisyen";

export interface UserInfo {
  id: number;
  username: string;
  fullName: string;
  title: string;
  regNo: string;
  role: Role;
}

/** Kesit piksel verisi. Mümkünse Int16/Uint16 saklanır (Float32'ye göre %50 bellek). */
export type Pixels = Float32Array | Int16Array | Uint16Array;

export type ToolName =
  | "wl"
  | "pan"
  | "zoom"
  | "length"
  | "angle"
  | "cobb"
  | "rect"
  | "ellipse"
  | "polygon"
  | "arrow"
  | "calib";

export type Layout = "1x1" | "1x2" | "2x1" | "2x2" | "1x3" | "3x1" | "2x3" | "3x2";

export type AiMode = "kapsamli" | "triyaj" | "ayirici" | "hasta";
/** review: her karede nicel görüntü incelemesi; BT dedektörleri patoloji adaylarını ayrıca üretir. */
export type AiProtocol = "auto" | "review" | "ct-head" | "ct-chest" | "none";

export type FindingApprovalStatus = "onaylandi" | "reddedildi" | "duzenlendi" | "bekliyor";

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Yalnızca DEMO (MR/CR örnek vakaları) için önceden tanımlı bulgu. */
export interface Lesion {
  sliceStart: number;
  sliceEnd: number;
  bbox: BBox;
  label: string;
  detail: string;
  category: string;
  severity: Severity;
  confidence: number;
  anatomicalLocation?: string;
  densityOrSignal?: string;
  sizeMmStr?: string;
}

export type FindingSource = "cv-heuristic" | "image-review" | "simulated-sample" | "manual";

export interface FindingMetrics {
  volumeMl?: number;
  maxDiameterMm?: number;
  zExtentMm?: number;
  meanHu?: number;
  maxHu?: number;
  lungRads?: string;
}

export interface Finding {
  id: string;
  sliceIndex: number;
  sliceStart: number;
  sliceEnd: number;
  keySliceNumber: number;
  sliceRangeStr: string;
  zLocationMm?: number;
  anatomicalLocation: string;
  densityOrSignal: string;
  sizeMmStr: string;
  bbox: BBox | null;
  /** Kesit bazlı sınırlayıcı kutu (CV motoru). Yoksa `bbox` kullanılır. */
  sliceBoxes?: Record<number, BBox>;
  label: string;
  detail: string;
  category: string;
  severity: Severity;
  confidence: number;
  /** "heuristic": kalibre edilmemiş aday skoru, "simulated": demo, "none": skor yok */
  confidenceKind: "heuristic" | "simulated" | "none";
  source: FindingSource;
  metrics?: FindingMetrics;
}

export interface Differential {
  dx: string;
  rationale: string;
  probability: number;
}

export type EngineKind = "cv-heuristic" | "image-review" | "simulated-sample" | "no-model";

/** Piksel verisinden gerçekten hesaplanır; hastalık tanısı veya akış hızı değildir. */
export interface ReviewFrameMetric {
  sliceIndex: number; // 0 tabanlı; ekranda +1 olarak sunulur
  mean: number;
  std: number;
  min: number;
  max: number;
  contrast: number; // %2 ve %98 persentil farkı (görüntü/sinyal birimi)
  changeFromPrevious: number; // önceki kareye kıyasla sinyal dağılımı farkı, yüzde
  colorCoverage?: number; // görüntüdeki renkli piksellerin oranı (görsel ölçüm)
  redCoverage?: number;
  blueCoverage?: number;
  colorBox?: BBox; // yalnızca renkli piksel konumu; lezyon kutusu DEĞİL
}

export interface ImageReview {
  modality: string;
  frameCount: number;
  mode: "color" | "grayscale";
  frames: ReviewFrameMetric[];
  /** 0 tabanlı; yalnızca nicel değişimin en yüksek olduğu temsili kareler. */
  keyFrames: number[];
  notes: string[];
}

export interface ModelCard {
  name: string;
  version: string;
  intendedUse: string;
  method: string;
  limitations: string[];
  validation: string;
}

export interface AnalysisResult {
  findings: Finding[];
  /** Klinik bulgu değil; her kare için gerçek piksel istatistikleri. */
  review?: ImageReview;
  triage: { level: string; score: number; note: string };
  differentials: Differential[];
  patientSummary: string;
  technique: string;
  qualityNote: string;
  findingsText: string;
  impression: string;
  recommendation: string;
  model: string;
  engine: EngineKind;
  modelCard: ModelCard;
}

export interface DicomTag {
  tag: string;
  name: string;
  value: string;
}

// ───────────── DICOM Specialized Objects (SR, PDF, ECG, GSPS, Overlays) ─────────────

export interface DicomOverlayPlane {
  group: number; // e.g. 0x6000, 0x6002
  rows: number;
  cols: number;
  originX: number; // 1-based origin
  originY: number;
  data: Uint8Array; // 1 = foreground overlay, 0 = transparent
  type: "G" | "R"; // Graphics or ROI
  label: string;
  visible?: boolean;
}

export interface GSPSGraphicObject {
  type: "POINT" | "POLYLINE" | "INTERPOLATED" | "CIRCLE" | "ELLIPSE";
  data: number[]; // normalized [0,1] or pixel coordinates
  filled?: boolean;
}

export interface GSPSTextObject {
  text: string;
  anchorPoint?: { x: number; y: number };
  boundingBox?: BBox;
}

export interface DicomGSPS {
  id: string;
  label: string;
  description: string;
  graphics: GSPSGraphicObject[];
  texts: GSPSTextObject[];
  displayedArea?: { tl: { x: number; y: number }; br: { x: number; y: number } };
  presentationLutShape?: "IDENTITY" | "INVERSE";
}

export interface SRNode {
  id: string;
  relationship?: string;
  valueType: "CONTAINER" | "TEXT" | "CODE" | "NUM" | "DATETIME" | "UIDREF" | "PNAME" | "IMAGE" | "COMPOSITE";
  conceptName?: { code: string; scheme: string; meaning: string };
  textValue?: string;
  codeValue?: { code: string; scheme: string; meaning: string };
  numValue?: { value: number; unit: string };
  referencedSlice?: number;
  children?: SRNode[];
}

export interface DicomSRDocument {
  id: string;
  title: string;
  sopInstanceUid: string;
  templateId?: string;
  completionFlag?: string;
  verificationFlag?: string;
  root: SRNode;
}

export interface EncapsulatedPDFDocument {
  id: string;
  title: string;
  sopInstanceUid: string;
  dataUrl: string;
  sizeBytes: number;
}

export interface ECGChannel {
  leadName: string;
  samples: Float32Array; // in mV
  samplingFrequency: number;
  sensitivity: number; // mm/mV
}

export interface DicomECGWaveform {
  id: string;
  title: string;
  samplingFrequency: number;
  durationSec: number;
  channels: ECGChannel[];
}

export interface DicomVideoSequence {
  id: string;
  title: string;
  videoUrl?: string;
  frameRate: number;
  totalFrames: number;
}

export type SpecialSeriesType = "image" | "sr" | "pdf" | "ecg" | "video";

export interface PaletteColorLUT {
  numEntries: number;
  firstMapped: number;
  bits: number;
  r: Uint8Array | Uint16Array;
  g: Uint8Array | Uint16Array;
  b: Uint8Array | Uint16Array;
}

export interface SeriesData {
  id: string;
  seriesUid?: string;
  modality: string;
  description: string;
  bodyPart: string;
  patientName: string;
  patientId: string;
  patientAge: string;
  patientSex: string;
  studyDate: string;
  institution: string;
  studyUid: string;
  width: number;
  height: number;
  pixelSpacing: number;
  sliceThickness: number;
  sliceSpacing?: number;
  slicePositions?: number[];
  orientation?: number[];
  frameOfRef?: string;
  defaultWL: number;
  defaultWW: number;
  unit: string;
  photometric?: string;
  isColor?: boolean;
  rgbaSlices?: Uint32Array[];
  paletteLut?: PaletteColorLUT;
  overlays?: DicomOverlayPlane[];
  gsps?: DicomGSPS[];
  specialType?: SpecialSeriesType;
  srData?: DicomSRDocument;
  pdfData?: EncapsulatedPDFDocument;
  ecgData?: DicomECGWaveform;
  videoData?: DicomVideoSequence;
  slices: Pixels[];
  lesions: Lesion[];
  tags: DicomTag[];
  isSample: boolean;
  files?: File[];
}

// ───────────── Hanging Protocols Engine ─────────────

export interface HangingProtocolCellConfig {
  cellIndex: number;
  seriesMatcher?: {
    modality?: string;
    descriptionRegex?: string;
    protocolNameRegex?: string;
    sequenceIndex?: number;
  };
  windowPreset?: string;
  customWL?: { wl: number; ww: number };
  syncSlice?: boolean;
  invert?: boolean;
  rotation?: 0 | 90 | 180 | 270;
  zoom?: number;
}

export interface HangingProtocolRule {
  id: string;
  name: string;
  description: string;
  isSystem?: boolean;
  match: {
    modalities?: string[];
    bodyParts?: string[];
    seriesDescriptionRegex?: string;
    protocolNameRegex?: string;
    minSeriesCount?: number;
  };
  layout: Layout;
  cells: HangingProtocolCellConfig[];
}

// ───────────── Annotations, Key Images, Reports & State ─────────────

export type AnnotationKind = "length" | "angle" | "cobb" | "arrow" | "rect" | "ellipse" | "polygon" | "calib";

export interface AnnotationStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  pixelCount: number;
}

export interface Annotation {
  id: string;
  kind: AnnotationKind;
  slice: number;
  points: { x: number; y: number }[];
  text?: string;
  stats?: AnnotationStats;
}

export interface KeyImage {
  id: string;
  slice: number;
  note: string;
  dataUrl: string;
}

export interface WindowPreset {
  name: string;
  wl: number;
  ww: number;
}

export interface ReportVersion {
  id: number;
  versionNo: number;
  action: string;
  createdByName: string;
  createdAt: string;
}

export interface ReportAddendum {
  id: number;
  text: string;
  createdByName: string;
  createdAt: string;
}

export interface SavedReport {
  id: number;
  studyId: number;
  status: "taslak" | "onaylandi";
  version: number;
  mode: string;
  clinicalInfo: string;
  technique: string;
  findingsText: string;
  impression: string;
  recommendation: string;
  findingsJson: Finding[];
  findingsApproval: Record<string, FindingApprovalStatus>;
  triageLevel: string;
  triageScore: number;
  aiModel: string;
  engine: string;
  modelCard: string;
  approvedBy: string;
  doctorTitle: string;
  doctorRegNo: string;
  institution: string;
  approvedAt: string | null;
  contentHash: string;
  signatureMeta: string;
  keyImageDataUrl: string;
  createdAt: string;
  updatedAt: string;
  patientName: string;
  patientId: string;
  patientAge: string;
  patientSex: string;
  studyDate: string;
  studyUid: string;
  modality: string;
  bodyPart: string;
  seriesDescription: string;
}

export interface StudyRow {
  id: number;
  studyUid: string;
  patientName: string;
  patientId: string;
  patientAge: string;
  patientSex: string;
  modality: string;
  bodyPart: string;
  studyDate: string;
  seriesDescription: string;
  institution: string;
  sliceCount: number;
  workStatus: string;
  assignedTo: number | null;
  assignedToName: string;
  triageLevel: string;
  triageScore: number;
  aiEngine: string;
  source: string;
  hasFiles: boolean;
  reportStatus: "taslak" | "onaylandi" | null;
  updatedAt: string;
}

export interface NotificationRow {
  id: number;
  createdAt: string;
  severity: string;
  studyUid: string;
  message: string;
  ackByName: string;
  ackAt: string | null;
}

export interface TemplateRow {
  id: number;
  name: string;
  modality: string;
  bodyPart: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
}
