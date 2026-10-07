/**
 * Modality taxonomy used by future, task-specific viewer/AI adapters.
 * Being listed here does not claim that the current HTML viewer can decode it
 * or that a clinically validated model exists for it.
 */
export type ModalityFamily =
  | 'cross-sectional'
  | 'projection'
  | 'ultrasound'
  | 'molecular-imaging'
  | 'interventional'
  | 'radiotherapy'
  | 'derived'
  | 'physiology'
  | 'other';

export interface ModalityDefinition {
  readonly code: string;
  readonly label: string;
  readonly family: ModalityFamily;
}

/** Common DICOM modality values; unlisted values remain valid via the open type below. */
export const DICOM_MODALITY_CATALOG = [
  { code: 'BDUS', label: 'Bone Densitometry Ultrasound', family: 'ultrasound' },
  { code: 'BMD', label: 'Bone Mineral Densitometry', family: 'projection' },
  { code: 'CR', label: 'Computed Radiography', family: 'projection' },
  { code: 'CT', label: 'Computed Tomography', family: 'cross-sectional' },
  { code: 'DX', label: 'Digital Radiography', family: 'projection' },
  { code: 'ECG', label: 'Electrocardiography', family: 'physiology' },
  { code: 'EEG', label: 'Electroencephalography', family: 'physiology' },
  { code: 'EMG', label: 'Electromyography', family: 'physiology' },
  { code: 'ES', label: 'Endoscopy', family: 'other' },
  { code: 'IO', label: 'Intra-oral Radiography', family: 'projection' },
  { code: 'MG', label: 'Mammography', family: 'projection' },
  { code: 'MR', label: 'Magnetic Resonance', family: 'cross-sectional' },
  { code: 'NM', label: 'Nuclear Medicine', family: 'molecular-imaging' },
  { code: 'OCT', label: 'Optical Coherence Tomography', family: 'other' },
  { code: 'OPT', label: 'Ophthalmic Tomography', family: 'other' },
  { code: 'OT', label: 'Other Modality', family: 'other' },
  { code: 'PT', label: 'Positron Emission Tomography', family: 'molecular-imaging' },
  { code: 'RF', label: 'Radio Fluoroscopy', family: 'interventional' },
  { code: 'RG', label: 'Radiographic Imaging', family: 'projection' },
  { code: 'RTDOSE', label: 'Radiotherapy Dose', family: 'radiotherapy' },
  { code: 'RTIMAGE', label: 'Radiotherapy Image', family: 'radiotherapy' },
  { code: 'RTPLAN', label: 'Radiotherapy Plan', family: 'radiotherapy' },
  { code: 'RTRECORD', label: 'Radiotherapy Record', family: 'radiotherapy' },
  { code: 'RTSTRUCT', label: 'Radiotherapy Structure Set', family: 'radiotherapy' },
  { code: 'SC', label: 'Secondary Capture', family: 'derived' },
  { code: 'SEG', label: 'Segmentation', family: 'derived' },
  { code: 'SM', label: 'Slide Microscopy', family: 'other' },
  { code: 'SR', label: 'Structured Report', family: 'derived' },
  { code: 'US', label: 'Ultrasound', family: 'ultrasound' },
  { code: 'XA', label: 'X-Ray Angiography', family: 'interventional' },
  { code: 'XC', label: 'External-camera Photography', family: 'other' },
] as const satisfies readonly ModalityDefinition[];

export type KnownDicomModalityCode = (typeof DICOM_MODALITY_CATALOG)[number]['code'];
/** Open-ended so vendor/private DICOM values can be represented without dropping data. */
export type ImagingModalityCode = KnownDicomModalityCode | (string & {});

/** Normalize a DICOM CS modality value; unknown but syntactically valid codes are retained. */
export function normalizeDicomModality(value: string): ImagingModalityCode | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9_]{1,16}$/.test(normalized) ? normalized : null;
}

export function findModalityDefinition(value: string): ModalityDefinition | undefined {
  const normalized = normalizeDicomModality(value);
  return DICOM_MODALITY_CATALOG.find(modality => modality.code === normalized);
}

export type ModelValidationState = 'not-assessed' | 'research-only' | 'externally-validated' | 'clinically-authorized';

/** Per-task capability manifest; model weights and clinical status are tracked separately. */
export interface ModelCapabilityManifest {
  readonly schemaVersion: 1;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly taskId: string;
  readonly anatomy: string;
  readonly modalities: readonly ImagingModalityCode[];
  readonly inputFormats: readonly ('DICOM' | 'NIfTI' | 'JPEG' | 'PNG')[];
  readonly weightsLicense: string;
  readonly artifactSha256?: string;
  readonly validationState: ModelValidationState;
  readonly requiresHumanReview: true;
}
