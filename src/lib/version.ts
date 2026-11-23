/**
 * Uygulama sürümü ve güncelleme kanalı.
 *
 * Sürüm numarası üç yerde aynı olmak zorundadır:
 *   1) buradaki APP_VERSION
 *   2) package.json -> version
 *   3) git etiketi (vX.Y.Z)
 * `windows/Paket.ps1` ve `.github/workflows/release.yml` bu üçünün uyuştuğunu denetler.
 */
export const APP_VERSION = "0.1.0";

/** Güncellemelerin yayınlandığı depo (kendi sürüm kütüphanemiz). */
export const GITHUB_REPO = "CehennemGibiyim/AtikViewer";

/** Son sürüm sayfası; API'ye ulaşılamazsa kullanıcı buraya yönlendirilir. */
export const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;
