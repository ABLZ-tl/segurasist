# syntax=docker/dockerfile:1.7

# ============== build ==============
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Dependencias del sistema mínimas para Prisma y ICU
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx prisma generate && npm run build

# Borra dev deps para copiar runtime mínimo
RUN npm prune --omit=dev

# ============== runtime ==============
FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist          ./dist
COPY --from=build /app/prisma        ./prisma
COPY --from=build /app/package.json  ./

EXPOSE 3000
USER 1001

CMD ["dist/main.js"]
