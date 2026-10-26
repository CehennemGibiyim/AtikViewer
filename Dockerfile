# ATIKVIEWER — Next.js (App Router) + PostgreSQL istemcisi, üretim imajı.
# Derleme:  docker build -t atikviewer .
# Çalıştırma: docker compose up --build -d   (önerilen; veritabanıyla birlikte)

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Derleme sırasında DB bağlantısı kurulmaz; ancak modül yükleme anındaki
# DATABASE_URL kontrolü için kukla değer gerekir.
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apk add --no-cache libc6-compat curl \
  && addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
# Şema uygulaması (drizzle-kit push) için gerekli dosyalar
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src/db/schema.ts ./src/db/schema.ts
RUN mkdir -p /app/.data && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
# İlk açılışta (ve her sürüm güncellemesinde) şemayı uygular, sonra uygulamayı başlatır.
# Render ve docker compose aynı komutu kullanır; DATABASE_URL zorunludur.
CMD ["sh", "-c", "./node_modules/.bin/drizzle-kit push --config=drizzle.config.ts --force && npm start"]
