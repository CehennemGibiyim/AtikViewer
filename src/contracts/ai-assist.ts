/**
 * TypeScript contract for the future local, human-reviewed AI assistance feature.
 * These types describe data shape only; they do not establish clinical validity.
 * AI findings must remain drafts until a qualified clinician reviews them.
 */

import type { ImagingModalityCode } from './radiology.js';

export type AnalysisStatus = 'complete' | 'inconclusive' | 'unsupported' | 'failed';

export type ReviewAction = 'accepted' | 'modified' | 'rejected' | 'deferred';

export interface ModelProvenance {
  readonly modelId: string;
  readonly modelVersion: string;
  /** License of the model weights, which can differ from the application license. */
  readonly weightsLicense: string;
  /** SHA-256 of the exact locally installed model artifact, when available. */
  readonly artifactSha256?: string;
  readonly runtime: string;
  readonly runtimeVersion: string;
}

export interface ImageReference {
  readonly sopInstanceUid: string;
  /** DICOM frame numbers are one-based. Omit for a single-frame instance. */
  readonly frameNumber?: number;
}

export interface CandidateFinding {
  readonly code?: string;
  readonly label: string;
  /** A model score is not a calibrated probability unless separately validated. */
  readonly score?: number;
  readonly imageReferences: readonly ImageReference[];
}

interface AssistiveResultBase {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly createdAt: string;
  readonly taskId: string;
  readonly modality: ImagingModalityCode;
  readonly model: ModelProvenance;
  readonly warnings: readonly string[];
  /** This is deliberately literal: no AI result is automatically signed or finalized. */
  readonly requiresHumanReview: true;
}

export type AssistiveAnalysisResult =
  | (AssistiveResultBase & {
      readonly status: 'complete';
      readonly candidates: readonly CandidateFinding[];
    })
  | (AssistiveResultBase & {
      readonly status: 'inconclusive' | 'unsupported' | 'failed';
      readonly candidates: readonly [];
    });

export interface ClinicianReview {
  readonly action: ReviewAction;
  readonly reviewedAt: string;
  /** Optional local user identifier; do not store patient identifiers in application logs. */
  readonly reviewerId?: string;
  readonly note?: string;
}
