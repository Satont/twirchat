# Backend Docker release workflow

## Goal

Restore publication of the backend Docker image after the v0.8.0 Wails release
workflow migration removed the previous `push-docker` job.

## Scope

Add one `backend-docker` job to `.github/workflows/release.yml`. It runs after
the release is created for stable `vX.Y.Z` tag pushes and manual releases.

The job builds `packages/backend/Dockerfile` from the repository root for
`linux/amd64` and `linux/arm64`, then pushes these tags to GHCR:

- `ghcr.io/<lowercase repository>/backend:vX.Y.Z`
- `ghcr.io/<lowercase repository>/backend:latest`

The workflow receives `packages: write` in addition to its existing release
permissions, authenticates with the workflow token, and retains GitHub Actions
cache-backed Docker layers. No application source, Dockerfile, compose file,
or desktop release behavior changes.

## Validation

Validate workflow YAML structure and Docker image construction locally. The
published image contract is also checked against `docker/docker-compose.yml`,
which consumes the `backend:latest` tag.
