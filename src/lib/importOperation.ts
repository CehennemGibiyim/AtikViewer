/**
 * Uzun süren dosya/codec işlemlerinde menüyü sonsuza kadar bekletmez.
 * İptal, sonuçları uygulamaktan vazgeçirir; senkron bir codec'in CPU işlemini kesemez.
 */
export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Yükleme iptal edildi", "AbortError");
}

export function withImportTimeout<T>(promise: Promise<T>, signal?: AbortSignal, ms = 30000): Promise<T> {
  assertNotAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const finish = (fn: () => void) => { if (settled) return; settled = true; cleanup(); fn(); };
    const abort = () => finish(() => reject(new DOMException("Yükleme iptal edildi", "AbortError")));
    const timer = setTimeout(() => finish(() => reject(new Error("Dosya/codec işlemi zaman aşımına uğradı"))), ms);
    signal?.addEventListener("abort", abort, { once: true });
    promise.then((result) => finish(() => resolve(result)), (error: unknown) => finish(() => reject(error)));
    if (signal?.aborted) abort();
  });
}
