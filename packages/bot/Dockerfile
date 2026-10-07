# Discord Bot — Node.js/discord.js service
# Multi-stage build for production

# ── Builder stage ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY packages/bot/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY packages/bot/src ./src
COPY packages/bot/tsconfig.json ./

# Build TypeScript
RUN npx tsc

# ── Runner stage ──────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user
RUN addgroup -g 1000 -S nodejs && \
    adduser -S -u 1000 -G nodejs nextjs

# Copy built files from builder
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./

# Switch to non-root user
USER nextjs

EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "dist/index.js"]