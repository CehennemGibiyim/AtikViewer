import { NextResponse, type NextRequest } from "next/server";

/**
 * Önizleme panelleri uygulamayı bazen kökeni "null" olan kısıtlı bir iframe içinde açar.
 * Bu durumda tarayıcı aynı sunucuya giden API isteklerini bile "farklı köken" sayar ve engeller
 * (ölçüm kaydı, rapor, çalışma listesi sessizce çalışmaz). Yalnızca iki köken kabul edilir:
 * uygulamanın kendi kökeni ve sandbox iframe'in "null" kökeni — üçüncü taraf siteler değil.
 */
function allowedOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (origin === "null") return "null";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return origin;
  } catch {
    /* geçersiz Origin */
  }
  return null;
}

export function proxy(req: NextRequest) {
  const origin = allowedOrigin(req);
  const cors: Record<string, string> = origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      }
    : {};
  if (req.method === "OPTIONS") return new NextResponse(null, { status: origin ? 204 : 403, headers: cors });
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: ["/api/:path*"] };
