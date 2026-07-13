# syntax=docker/dockerfile:1

# Stage 1: Build the binary
FROM oven/bun:canary AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/shared/package.json ./packages/shared/
COPY patches ./patches

# Install dependencies
RUN bun install

# Copy source code
COPY packages/backend ./packages/backend
COPY packages/shared ./packages/shared

# Build the binary
WORKDIR /app/packages/backend
RUN bun run build:prod

# Stage 2: Create minimal runtime image
FROM debian:bookworm-slim AS runner

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary from builder
COPY --from=builder /app/packages/backend/.out/backend /app/backend

# Expose the port your backend listens on
EXPOSE 3000

# Run the binary
CMD ["./backend"]
