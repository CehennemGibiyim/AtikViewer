import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  real,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** Tek satırlık operatör profili (id=1). Giriş/parola yoktur; yalnızca rapor imza adı ve atama için. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  title: text("title").notNull().default(""),
  regNo: text("reg_no").notNull().default(""),
  role: text("role").notNull().default("radyolog"), // yonetici | radyolog | teknisyen
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    ts: timestamp("ts", { precision: 3 }).notNull(),
    userId: integer("user_id"),
    username: text("username").notNull().default(""),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull().default(""),
    entityId: text("entity_id").notNull().default(""),
    details: text("details").notNull().default("{}"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_logs_ts_idx").on(t.ts)]
);

export const studies = pgTable("studies", {
  id: serial("id").primaryKey(),
  studyUid: text("study_uid").notNull().unique(),
  patientName: text("patient_name").notNull().default("ANONIM"), // şifreli
  patientId: text("patient_id").notNull().default("TR-000001"), // şifreli
  patientAge: text("patient_age").notNull().default("-"),
  patientSex: text("patient_sex").notNull().default("U"),
  modality: text("modality").notNull(),
  bodyPart: text("body_part").notNull(),
  studyDate: text("study_date").notNull().default(""),
  seriesDescription: text("series_description").notNull(),
  institution: text("institution").notNull().default(""),
  sliceCount: integer("slice_count").notNull().default(1),
  workStatus: text("work_status").notNull().default("bekliyor"), // bekliyor | okunuyor | taslak | onayli
  assignedTo: integer("assigned_to").references(() => users.id, { onDelete: "set null" }),
  triageLevel: text("triage_level").notNull().default(""),
  triageScore: real("triage_score").notNull().default(0),
  aiEngine: text("ai_engine").notNull().default(""),
  source: text("source").notNull().default("yerel"), // yerel | pacs | his
  accession: text("accession").notNull().default(""),
  hasFiles: boolean("has_files").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id")
    .notNull()
    .references(() => studies.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("taslak"),
  version: integer("version").notNull().default(1),
  mode: text("mode").notNull().default("kapsamli"),
  clinicalInfo: text("clinical_info").notNull().default(""), // şifreli
  technique: text("technique").notNull().default(""),
  findingsText: text("findings_text").notNull().default(""),
  impression: text("impression").notNull().default(""),
  recommendation: text("recommendation").notNull().default(""),
  findingsJson: jsonb("findings_json").notNull().default([]),
  findingsApproval: jsonb("findings_approval").notNull().default({}),
  triageLevel: text("triage_level").notNull().default("rutin"),
  triageScore: real("triage_score").notNull().default(0),
  aiModel: text("ai_model").notNull().default(""),
  engine: text("engine").notNull().default(""),
  modelCard: text("model_card").notNull().default(""),
  approvedBy: text("approved_by").notNull().default(""),
  doctorTitle: text("doctor_title").notNull().default(""),
  doctorRegNo: text("doctor_reg_no").notNull().default(""),
  institution: text("institution").notNull().default(""),
  approvedAt: timestamp("approved_at"),
  contentHash: text("content_hash").notNull().default(""),
  signatureMeta: text("signature_meta").notNull().default(""),
  keyImageDataUrl: text("key_image_data_url").notNull().default(""), // şifreli
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const reportVersions = pgTable("report_versions", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  versionNo: integer("version_no").notNull(),
  action: text("action").notNull(),
  snapshot: text("snapshot").notNull(),
  createdBy: integer("created_by"),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const reportAddenda = pgTable("report_addenda", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdBy: integer("created_by"),
  createdByName: text("created_by_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Seri bazlı ölçüm/anotasyon ve anahtar kesitler. keyImages şifreli JSON. */
export const studyState = pgTable(
  "study_state",
  {
    id: serial("id").primaryKey(),
    studyUid: text("study_uid").notNull(),
    seriesKey: text("series_key").notNull(),
    annotations: text("annotations").notNull().default("[]"),
    keyImages: text("key_images").notNull().default(""),
    updatedBy: integer("updated_by"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("study_state_uq").on(t.studyUid, t.seriesKey)]
);

export const storedFiles = pgTable("stored_files", {
  id: serial("id").primaryKey(),
  studyId: integer("study_id")
    .notNull()
    .references(() => studies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  path: text("path").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  severity: text("severity").notNull(),
  studyUid: text("study_uid").notNull().default(""),
  message: text("message").notNull(),
  ackBy: integer("ack_by"),
  ackByName: text("ack_by_name").notNull().default(""),
  ackAt: timestamp("ack_at"),
});

export const reportTemplates = pgTable("report_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  modality: text("modality").notNull().default(""),
  bodyPart: text("body_part").notNull().default(""),
  technique: text("technique").notNull().default(""),
  findings: text("findings").notNull().default(""),
  impression: text("impression").notNull().default(""),
  recommendation: text("recommendation").notNull().default(""),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});

export type Study = typeof studies.$inferSelect;
export type Report = typeof reports.$inferSelect;
