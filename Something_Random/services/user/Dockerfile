# Campusly User Service Dockerfile
FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
COPY services/user/package.json ./services/user/
COPY packages/*/package.json ./packages/
RUN npm ci --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

WORKDIR /app/services/user
RUN npm run build

FROM base AS runner
WORKDIR /app

COPY --from=builder /app/services/user/dist ./dist
COPY --from=builder /app/services/user/package.json ./
COPY --from=deps /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=3002

EXPOSE 3002

CMD ["node", "dist/index.js"]
