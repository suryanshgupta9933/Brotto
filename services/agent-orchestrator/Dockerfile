# Agent Orchestrator Dockerfile
# Multi-stage build for optimized production image

FROM node:20-alpine AS base

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# ============================================================================
# Dependencies stage
# ============================================================================
FROM base AS deps

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production --ignore-scripts

# ============================================================================
# Dev dependencies stage
# ============================================================================
FROM base AS dev-deps

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies
RUN npm ci

# ============================================================================
# Builder stage
# ============================================================================
FROM dev-deps AS builder

# Copy source
COPY . .

# Build the application
RUN npm run build

# ============================================================================
# Production stage
# ============================================================================
FROM base AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy package files
COPY package.json ./

# Install production dependencies only
RUN npm ci --only=production --ignore-scripts

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Set ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Default command
CMD ["node", "dist/server.js"]
