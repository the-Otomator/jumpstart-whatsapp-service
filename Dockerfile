# ── Stage 1: Build TypeScript ──────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ARG GIT_SHA
ARG GIT_BRANCH
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN test -n "$GIT_SHA" \
    && test "$GIT_SHA" != "unknown" \
    && test -n "$GIT_BRANCH" \
    && test "$GIT_BRANCH" != "unknown" \
    && node -e "const fs=require('fs'); fs.writeFileSync('src/buildInfo.ts', 'export const IMAGE_GIT_SHA = ' + JSON.stringify(process.env.GIT_SHA) + '\\nexport const IMAGE_GIT_BRANCH = ' + JSON.stringify(process.env.GIT_BRANCH) + '\\n')"
RUN npm run build

# ── Stage 2: Production image ─────────────────────
FROM node:20-alpine
ARG GIT_SHA
ARG GIT_BRANCH
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
ENV GIT_BRANCH=$GIT_BRANCH
LABEL org.opencontainers.image.revision=$GIT_SHA
LABEL org.opencontainers.image.ref.name=$GIT_BRANCH
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3001
CMD ["node", "dist/index.js"]
