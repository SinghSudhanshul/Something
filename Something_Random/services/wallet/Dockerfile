# Campusly Wallet Service Dockerfile
FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
COPY services/wallet/package.json ./services/wallet/
COPY packages/*/package.json ./packages/
RUN npm ci --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

WORKDIR /app/services/wallet
RUN npm run build

FROM base AS runner
WORKDIR /app

COPY --from=builder /app/services/wallet/dist ./dist
COPY --from=builder /app/services/wallet/package.json ./
COPY --from=deps /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=3003

EXPOSE 3003

CMD ["node", "dist/index.js"]
