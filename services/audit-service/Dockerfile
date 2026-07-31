# Audit Service Dockerfile
# Multi-stage build for optimized production image

# ============ Build Stage ============
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source
COPY tsconfig.json ./
COPY jest.config.js ./
COPY src ./src

# Build TypeScript
RUN npm run build

# ============ Production Stage ============
FROM node:20-alpine AS production

# Security: Run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy migrations
COPY --chown=appuser:appgroup migrations ./migrations

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Change to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Run migrations and start server
CMD ["sh", "-c", "node dist/migrations/run.js && node dist/server.js"]
