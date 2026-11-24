import type { CxrValidationReport } from "./cxrValidation";

/**
 * OTOMATİK ÜRETİLEN DOSYA — elle düzenlemeyin.
 * `npm run validate:cxr` (scripts/cxr-validate.ts) tarafından yazılır.
 * Rapor sentetik (phantom) setten gelir; gerçek hasta verisi doğrulaması DEĞİLDİR.
 */
export const CXR_VALIDATION_REPORT: CxrValidationReport = {
  "version": "1",
  "generatedAt": "2026-11-24T13:13:39.556Z",
  "dataset": {
    "kind": "synthetic",
    "name": "ATIKVIEWER sentetik akciğer grafisi phantom seti (PA, 512×512)",
    "cases": 140,
    "positives": 20,
    "negatives": 120,
    "note": "Gerçek hasta görüntüsü DEĞİLDİR: anlatılan geometriye göre üretilmiş phantom setidir. Klinik duyarlılık/özgüllük için kendi arşivinizden etiketli CR/DX setiyle yeniden ölçüm gerekir."
  },
  "categories": {
    "Kardiyomegali": {
      "positives": 20,
      "negatives": 120,
      "tp": 20,
      "fp": 0,
      "tn": 120,
      "fn": 0,
      "sensitivity": 1,
      "specificity": 1,
      "sensitivity95": {
        "low": 0.839,
        "high": 1
      },
      "specificity95": {
        "low": 0.969,
        "high": 1
      }
    },
    "Plevral efüzyon": {
      "positives": 20,
      "negatives": 120,
      "tp": 20,
      "fp": 0,
      "tn": 120,
      "fn": 0,
      "sensitivity": 1,
      "specificity": 1,
      "sensitivity95": {
        "low": 0.839,
        "high": 1
      },
      "specificity95": {
        "low": 0.969,
        "high": 1
      }
    },
    "Konsolidasyon": {
      "positives": 20,
      "negatives": 120,
      "tp": 16,
      "fp": 0,
      "tn": 120,
      "fn": 4,
      "sensitivity": 0.8,
      "specificity": 1,
      "sensitivity95": {
        "low": 0.584,
        "high": 0.919
      },
      "specificity95": {
        "low": 0.969,
        "high": 1
      }
    },
    "Pnömotoraks": {
      "positives": 20,
      "negatives": 120,
      "tp": 20,
      "fp": 0,
      "tn": 120,
      "fn": 0,
      "sensitivity": 1,
      "specificity": 1,
      "sensitivity95": {
        "low": 0.839,
        "high": 1
      },
      "specificity95": {
        "low": 0.969,
        "high": 1
      }
    },
    "Nodül": {
      "positives": 20,
      "negatives": 120,
      "tp": 20,
      "fp": 0,
      "tn": 120,
      "fn": 0,
      "sensitivity": 1,
      "specificity": 1,
      "sensitivity95": {
        "low": 0.839,
        "high": 1
      },
      "specificity95": {
        "low": 0.969,
        "high": 1
      }
    }
  },
  "thresholds": {
    "ctrUpperLimit": 0.5,
    "effusionSlopeMm": 2,
    "effusionBelowFraction": 0.45,
    "consolidationMinDiaMm": 15,
    "noduleMinDiaMm": 3,
    "noduleMaxDiaMm": 15,
    "noduleFillRatio": 0.6,
    "ptxDarkFraction": 0.25,
    "ptxAsymmetry": 0.12,
    "maxWorkDim": 1024,
    "tuningSet": "seed 777",
    "measurementSet": "seed 4242"
  }
};
