import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  // Keep the starter on the flat config export that actually runs under the pinned ESLint/Next toolchain.
  ...nextCoreWebVitals,
  // .venv: windows\Kurulum.ps1'in oluşturduğu Python sanal ortamı (iinde JS dosyalar var)
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "src/lib/vendor/**", ".venv/**", "windows/**"]),
]);
