# syntax=docker/dockerfile:1

# Stage 1: Build the binary
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json ./packages/shared/
COPY packages/desktop/package.json ./packages/desktop/

# Install dependencies
RUN bun install --frozen-lockfile --filter '!@twirchat/desktop'

# Copy source code
COPY packages/backend ./packages/backend
COPY packages/shared ./packages/shared

# Build the binary
WORKDIR /app/packages/backend
RUN NODE_ENV=production bun run build:prod

# Stage 2: Create minimal runtime image
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS runner

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 twirchat \
    && useradd --system --uid 10001 --gid twirchat --create-home twirchat

# Copy the compiled binary from builder
COPY --from=builder --chown=10001:10001 /app/packages/backend/.out/backend /app/backend

ENV NODE_ENV=production PORT=3000
USER 10001:10001

# Expose the port your backend listens on
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl --fail --silent "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# Run the binary
ENTRYPOINT ["/app/backend"]
