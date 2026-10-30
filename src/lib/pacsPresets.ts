/**
 * PACS (DICOMweb) bağlantı ayarları — ön yükleme (Yönetim paneli) ve sunucu tarafı ortak.
 *
 * Piyasa araştırmasının çıktısı (kaynaklar: DICOM PS3.18, Orthanc/dcm4chee belgeleri,
 * OHIF dicomweb dataSource yapılandırması):
 *  - QIDO-RS ve WADO-RS kökleri BAĞIMSIZ mutlak URL'lerdir; tek tabandan birleştirilmez
 *    (dcm4chee `/rs` ile `/wado`'yu ayırır). Bu yüzden ayrı alanlar tutulur.
 *  - Kimlik doğrulama kuruma göre değişir: HTTP Basic (Orthanc), Bearer/OIDC
 *    (Keycloak, Google Healthcare), özel başlık (bazı bulut/portallar), ya da yok.
 *  - DIMSE (C-FIND/C-MOVE) tarayıcıdan konuşulamaz; yalnızca HTTP sunan DICOMweb
 *    uçları veya bir kapı (Orthanc/dcm4chee) kullanılabilir.
 */

export type PacsAuthType = "none" | "basic" | "bearer" | "header";

export interface PacsAuth {
  type: PacsAuthType;
  username: string;
  /** Sunucuda AES-256-GCM ile şifreli saklanır; yönetim API'si GET'te boş döndürür. */
  password: string;
  token: string;
  /** API anahtarı/tip-başlık: başlık adı ör. `X-Api-Key`. */
  headerName: string;
  headerValue: string;
}

export type PacsKind = "orthanc" | "dcm4chee" | "google" | "azure" | "custom";

export interface PacsConfig {
  /** Görüntüleme adı (ör. "Radyoloji PACS — Orthanc"). */
  name: string;
  kind: PacsKind;
  /** QIDO-RS kökü (arama). Çoğu sunucuda WADO-RS de aynı köktedir. */
  qidoRoot: string;
  /** WADO-RS kökü; boşsa qidoRoot kullanılır. */
  wadoRoot: string;
  auth: PacsAuth;
  /** Kurum içi sunucularda yaygın olan self-signed sertifika (yalnızca sunucu tarafı). */
  allowSelfSigned: boolean;
  /** QIDO sonuç üst sınırı. */
  limit: number;
  /** Sunucu `includefield` desteklemiyorsa kapatılır (bazı eski sürümeler). */
  includefield: boolean;
  /** Kuruma özgü notlar (AE başlığı, port, conformance statement vb.). */
  notes: string;
}

export const EMPTY_AUTH: PacsAuth = { type: "none", username: "", password: "", token: "", headerName: "", headerValue: "" };

export const DEFAULT_PACS: PacsConfig = {
  name: "",
  kind: "custom",
  qidoRoot: "",
  wadoRoot: "",
  auth: { ...EMPTY_AUTH },
  allowSelfSigned: false,
  limit: 50,
  includefield: true,
  notes: "",
};

export interface PacsPreset {
  kind: PacsKind;
  label: string;
  /** Formu dolduran varsayılanlar; `<host>` yer tutucuları kullanıcı tarafından düzenlenir. */
  fill: Partial<PacsConfig>;
  /** Kurulum/ipucu notu (form altında gösterilir). */
  hint: string;
}

/**
 * Piyasada gerçekten karşılaşılan sistemler. URL'ler vendor conformance statement'ından
 * veya resmî belgeden alınır; tahmini değer girilmez.
 */
export const PACS_PRESETS: PacsPreset[] = [
  {
    kind: "orthanc",
    label: "Orthanc (DICOMweb eklentisi)",
    fill: {
      name: "Orthanc",
      qidoRoot: "http://<host>:8042/dicom-web",
      wadoRoot: "",
      auth: { type: "basic", username: "", password: "", token: "", headerName: "", headerValue: "" },
      limit: 50,
      includefield: true,
      notes:
        "DIMSE: AE başlığı ORTHANC, port 4242 · HTTP/DICOMweb portu 8042, kök /dicom-web/.\n" +
        "Sunucu tarafında: RemoteAccessAllowed=true, DefaultEncoding=Utf8 (Türkçe adlar için zorunlu).\n" +
        "QIDO büyük/küçük harfe duyarlıdır (QidoCaseSensitive=true); aramada doğru yazım gerekir.",
    },
    hint: "Orthanc kurulumunda DICOMweb eklentisi açık olmalı (Plugins: DICOMWeb).",
  },
  {
    kind: "dcm4chee",
    label: "dcm4chee-arc 5 (dcm4che)",
    fill: {
      name: "dcm4chee-arc",
      qidoRoot: "https://<host>:8443/dcm4chee-arc/aets/DCM4CHEE/rs",
      wadoRoot: "",
      auth: { type: "none", username: "", password: "", token: "", headerName: "", headerValue: "" },
      limit: 100,
      includefield: true,
      notes:
        "QIDO/WADO/STOW aynı kökte: /dcm4chee-arc/aets/{AET}/rs · WADO-URI ayrı: /aets/{AET}/wado.\n" +
        "Güvenli sürümde (secure=all) Keycloak/OIDC kullanılır → kimlik tipi 'Bearer (token)' seçin.\n" +
        "Uzak DIMSE sorguları için /dimse/{findscp} REST köprüsü vardır.",
    },
    hint: "AET yol segmenti örneklerde DCM4CHEE'dir; kendi AET'nizle değiştirin.",
  },
  {
    kind: "google",
    label: "Google Cloud Healthcare API",
    fill: {
      name: "Google Healthcare",
      qidoRoot: "https://healthcare.googleapis.com/v1/projects/<proje>/locations/<bolge>/datasets/<veri-seti>/dicomStores/<depo>/dicomWeb",
      wadoRoot: "",
      auth: { type: "bearer", username: "", password: "", token: "", headerName: "", headerValue: "" },
      notes: "Erişim: OAuth2 erişim jetonu (gcloud auth print-access-token). Yalnızca REST/DICOMweb.",
    },
    hint: "Jeton kısa ömürlüdür; sunucu tarafında yenilenen jeton kullanın.",
  },
  {
    kind: "azure",
    label: "Azure Health Data Services (DICOM)",
    fill: {
      name: "Azure DICOM",
      qidoRoot: "https://<servis-url>/v1",
      wadoRoot: "",
      auth: { type: "bearer", username: "", password: "", token: "", headerName: "", headerValue: "" },
      notes: "API sürümü (/v1) taban URL'in parçasıdır. Yalnızca Explicit VR transfer sözdizimi kabul edilir.",
    },
    hint: "Azure kimlik erişimi (OAuth2) jetonu gerekir.",
  },
  {
    kind: "custom",
    label: "DIMSE-only eski PACS (C-FIND/C-MOVE)",
    fill: {
      name: "",
      qidoRoot: "",
      wadoRoot: "",
      auth: { ...EMPTY_AUTH },
      notes:
        "Bu tür sistemler (ör. Conquest, birçok üretici PACS'i) yalnızca DIMSE konuşur; tarayıcıdan erişilemez.\n" +
        "Çözüm: önünde bir kapı çalıştırın — Orthanc (DICOMweb eklentisi) veya dcm4chee (REST köprüsü) —\n" +
        "ve buraya o kapının DICOMweb adresini girin.",
    },
    hint: "DICOMweb sunmayan sistemler için önce Orthanc/dcm4chee kapısı kurulmalı.",
  },
  {
    kind: "custom",
    label: "Özel / üretici DICOMweb",
    fill: { name: "", qidoRoot: "https://<pacs>/…", wadoRoot: "", auth: { ...EMPTY_AUTH }, notes: "" },
    hint: "Değerleri üreticinin DICOM conformance statement belgesinden alın; tahmin etmeyin.",
  },
];

export const AUTH_LABELS: Record<PacsAuthType, string> = {
  none: "Yok (açık)",
  basic: "Basic (kullanıcı adı / parola)",
  bearer: "Bearer (token / OIDC)",
  header: "Özel başlık (API anahtarı)",
};

/** URL doğrulama — yalnızca http(s). */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Sondaki fazla / işaretlerini temizle (taban kök için). */
export const trimRoot = (s: string) => s.trim().replace(/\/+$/, "");
