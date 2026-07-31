# Build stage
FROM golang:1.21-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o cdp-relay \
    ./cmd/server

# Runtime stage
FROM scratch

# Import certificates for HTTPS/TLS
IMPORT_CERTIFICATES="ca-certificates_bundle.crt"
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# Set timezone data
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

WORKDIR /app

# Copy the binary
COPY --from=builder /app/cdp-relay .

# Create non-root user
RUN adduser -D -u 1000 cdp-relay
USER cdp-relay

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Default command
ENTRYPOINT ["./cdp-relay"]
CMD ["--address=0.0.0.0:8080"]
