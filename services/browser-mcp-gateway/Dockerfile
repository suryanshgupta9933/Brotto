# syntax=docker/dockerfile:1

###
# Browser MCP Gateway
# Internal service for Playwright MCP per-session isolation
###

# ---- Base Stage ----
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies needed for Playwright
RUN apk add --no-cache \
    chromium \
    chromium-chromedriver \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    udev

# Set Playwright environment variables
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ---- Dependencies Stage ----
FROM base AS deps

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production

# ---- Development Stage ----
FROM base AS development

WORKDIR /app

# Copy source
COPY . .

# Install all dependencies
RUN npm ci

# Development command
CMD ["npm", "run", "dev"]

# ---- Build Stage ----
FROM base AS build

WORKDIR /app

# Copy source
COPY . .

# Install dependencies
RUN npm ci

# Build TypeScript
RUN npm run build

# ---- Production Stage ----
FROM base AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built artifacts
COPY --from=build /app/dist ./dist

# Copy source maps for debugging (optional, remove for smaller image)
# COPY --from=build /app/dist/*.map ./dist/

# Set environment
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start the service
CMD ["node", "dist/server.js"]
