#!/usr/bin/env sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "[HATA] Node.js 18+ bulunamadı. https://nodejs.org adresinden LTS sürümünü yükleyin."
  exit 1
fi

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)" || {
  echo "[HATA] Node.js 18 veya daha yeni bir LTS sürümü gerekli."
  exit 1
}

if ! command -v npm >/dev/null 2>&1; then
  echo "[HATA] npm bulunamadı. Node.js LTS kurulumunu onarın veya yeniden kurun."
  exit 1
fi

if [ ! -f node_modules/express/package.json ]; then
  echo "[BİLGİ] Kilit dosyasındaki bağımlılıklar kuruluyor..."
  npm ci --fund=false --audit=false
fi

echo "[OK] Yerel AtikViewer başlatılıyor: http://127.0.0.1:3000"
exec npm start
