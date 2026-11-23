import { eq } from "drizzle-orm";
import { db } from "@/db";
import { studies, type Report, type Study } from "@/db/schema";
import { decryptText, encryptText } from "./crypto";
import type { Finding, FindingApprovalStatus, SavedReport, StudyRow } from "@/lib/types";

export interface StudyMeta {
  studyUid: string;
  patientName?: string;
  patientId?: string;
  patientAge?: string;
  patientSex?: string;
  studyDate?: string;
  institution?: string;
  modality: string;
  bodyPart: string;
  seriesDescription: string;
  sliceCount?: number;
  accession?: string;
}

export async function upsertStudy(m: StudyMeta, source: string): Promise<{ id: number; created: boolean }> {
  const ex = await db.select({ id: studies.id }).from(studies).where(eq(studies.studyUid, m.studyUid)).limit(1);
  if (ex[0]) {
    await db
      .update(studies)
      .set({
        modality: m.modality,
        bodyPart: m.bodyPart,
        seriesDescription: m.seriesDescription,
        ...(m.sliceCount ? { sliceCount: m.sliceCount } : {}),
        ...(m.institution ? { institution: m.institution } : {}),
        updatedAt: new Date(),
      })
      .where(eq(studies.id, ex[0].id));
    return { id: ex[0].id, created: false };
  }
  const ins = await db
    .insert(studies)
    .values({
      studyUid: m.studyUid,
      patientName: encryptText(m.patientName || "ANONİM"),
      patientId: encryptText(m.patientId || "-"),
      patientAge: m.patientAge || "-",
      patientSex: m.patientSex || "-",
      studyDate: m.studyDate || "",
      institution: m.institution || "",
      modality: m.modality,
      bodyPart: m.bodyPart,
      seriesDescription: m.seriesDescription,
      sliceCount: m.sliceCount ?? 1,
      accession: m.accession ?? "",
      source,
    })
    .returning({ id: studies.id });
  return { id: ins[0].id, created: true };
}

export function mapStudyRow(s: Study, assignedName: string | null, reportStatus: string | null): StudyRow {
  return {
    id: s.id,
    studyUid: s.studyUid,
    patientName: decryptText(s.patientName),
    patientId: decryptText(s.patientId),
    patientAge: s.patientAge,
    patientSex: s.patientSex,
    modality: s.modality,
    bodyPart: s.bodyPart,
    studyDate: s.studyDate,
    seriesDescription: s.seriesDescription,
    institution: s.institution,
    sliceCount: s.sliceCount,
    workStatus: s.workStatus,
    assignedTo: s.assignedTo,
    assignedToName: assignedName ?? "",
    triageLevel: s.triageLevel,
    triageScore: s.triageScore,
    aiEngine: s.aiEngine,
    source: s.source,
    hasFiles: s.hasFiles,
    reportStatus: reportStatus === "taslak" || reportStatus === "onaylandi" ? reportStatus : null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function mapReport(r: Report, s: Study): SavedReport {
  return {
    id: r.id,
    studyId: r.studyId,
    status: r.status === "onaylandi" ? "onaylandi" : "taslak",
    version: r.version,
    mode: r.mode,
    clinicalInfo: decryptText(r.clinicalInfo),
    technique: r.technique,
    findingsText: r.findingsText,
    impression: r.impression,
    recommendation: r.recommendation,
    findingsJson: (r.findingsJson as Finding[]) ?? [],
    findingsApproval: (r.findingsApproval as Record<string, FindingApprovalStatus>) ?? {},
    triageLevel: r.triageLevel,
    triageScore: r.triageScore,
    aiModel: r.aiModel,
    engine: r.engine,
    modelCard: r.modelCard,
    approvedBy: r.approvedBy,
    doctorTitle: r.doctorTitle,
    doctorRegNo: r.doctorRegNo,
    institution: r.institution || s.institution,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    contentHash: r.contentHash,
    signatureMeta: r.signatureMeta,
    keyImageDataUrl: decryptText(r.keyImageDataUrl),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    patientName: decryptText(s.patientName),
    patientId: decryptText(s.patientId),
    patientAge: s.patientAge,
    patientSex: s.patientSex,
    studyDate: s.studyDate,
    studyUid: s.studyUid,
    modality: s.modality,
    bodyPart: s.bodyPart,
    seriesDescription: s.seriesDescription,
  };
}
