# ── Stage 1: Build TypeScript ──────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# ── Stage 2: Production image ─────────────────────
FROM node:20-alpine
ENV NODE_ENV=production
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
# Build-time git provenance (supplied by scripts/deploy.sh; .git is not in the image)
ARG GIT_SHA=unknown
ARG GIT_BRANCH=unknown
ENV GIT_SHA=$GIT_SHA
ENV GIT_BRANCH=$GIT_BRANCH
EXPOSE 3001
CMD ["node", "dist/index.js"]
