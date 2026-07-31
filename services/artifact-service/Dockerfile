# Artifact Service Dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY jest.config.js ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S artifact-service && \
    adduser -S artifact-service -u 1001 -G artifact-service

# Create necessary directories
RUN mkdir -p /var/artifact-service/storage && \
    mkdir -p /tmp/artifact-service && \
    chown -R artifact-service:artifact-service /var/artifact-service && \
    chown -R artifact-service:artifact-service /tmp/artifact-service

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev && \
    npm cache clean --force

# Set environment defaults
ENV NODE_ENV=production
ENV ARTIFACT_SERVICE_PORT=3001
ENV ARTIFACT_SERVICE_HOST=0.0.0.0

# Expose port
EXPOSE 3001

# Change to non-root user
USER artifact-service

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the service
CMD ["node", "dist/server.js"]
