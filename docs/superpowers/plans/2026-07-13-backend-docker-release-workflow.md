# Backend Docker Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`
> to implement this configuration-only plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Restore automatic GHCR publication of the backend Docker image from
the existing release workflow.

**Architecture:** Extend the existing release workflow with one independent
job that runs after release creation. It builds the existing backend Dockerfile
from the repository root using Buildx and publishes a multi-architecture image
to GHCR with immutable version and rolling `latest` tags.

**Tech Stack:** GitHub Actions, Docker Buildx, GitHub Container Registry,
Bun-based backend Dockerfile.

## Global Constraints

- Modify only `.github/workflows/release.yml` for the delivery behavior.
- Build `packages/backend/Dockerfile` with repository-root build context.
- Publish `linux/amd64` and `linux/arm64` images only for stable releases.
- Use `${{ github.token }}` to authenticate to GHCR.
- Do not commit any changes, per user instruction.
- Preserve all existing unrelated working-tree changes.

---

### Task 1: Restore backend Docker publication

**Files:**

- Modify: `.github/workflows/release.yml`
- Verify: `packages/backend/Dockerfile`
- Verify: `docker/docker-compose.yml`

**Interfaces:**

- Consumes: `needs.version.outputs.version` and `${{ github.repository }}` from
  the existing workflow.
- Produces: `ghcr.io/<lowercase-repository>/backend:<version>` and
  `ghcr.io/<lowercase-repository>/backend:latest` image manifests.

- [ ] **Step 1: Establish the pre-change failure condition**

  Run:

  ```bash
  rg -n 'packages: write|backend-docker|packages/backend/Dockerfile' \
    .github/workflows/release.yml
  ```

  Expected: no `backend-docker` job and no `packages: write` permission.

- [ ] **Step 2: Add the smallest workflow change**

  In `.github/workflows/release.yml`, grant `packages: write` at workflow scope.
  Add this job after the `release` job:

  ```yaml
  backend-docker:
    needs: [version, release]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ github.token }}
      - id: image
        shell: bash
        run: echo "repository=${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"
      - uses: docker/build-push-action@v5
        with:
          context: .
          file: ./packages/backend/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/${{ steps.image.outputs.repository }}/backend:${{ needs.version.outputs.version }}
            ghcr.io/${{ steps.image.outputs.repository }}/backend:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
  ```

- [ ] **Step 3: Verify the workflow contract statically**

  Run:

  ```bash
  rg -n 'packages: write|backend-docker|packages/backend/Dockerfile|linux/amd64,linux/arm64|backend:latest' \
    .github/workflows/release.yml
  rg -n 'image: ghcr.io/.*/backend:latest' docker/docker-compose.yml
  ```

  Expected: the workflow grants package publishing rights, builds the backend
  Dockerfile for both declared platforms, and compose consumes its `latest`
  image tag.

- [ ] **Step 4: Validate the Docker build input locally**

  Run:

  ```bash
  docker build --file packages/backend/Dockerfile --tag twirchat-backend:ci .
  ```

  Expected: exit code 0 and a local `twirchat-backend:ci` image.

- [ ] **Step 5: Apply required repository checks without changing unrelated files**

  Run:

  ```bash
  bun run fix
  bun run lint
  bun run typecheck
  ```

  Expected: formatter/linter/type checker exit code 0. If `bun run fix` would
  alter unrelated user changes, stop before accepting those changes and report
  the affected paths.
