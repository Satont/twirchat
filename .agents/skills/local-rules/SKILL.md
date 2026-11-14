# Local Agent Rules

## Check Execution Policy

**NEVER run the following checks automatically or proactively:**

- `bun run typecheck`
- `bun run test` / `bun test`
- `bun run lint` / `bun run lint:fix`
- `bun run format` / `bun run format:check`
- `bun run check`
- Any CI/CD validation commands

**ONLY run these checks when the user explicitly requests:**
- "Make a PR" / "Open a PR" / "Create a PR"
- "Run checks" / "Run typecheck" / "Run tests"
- "Prepare for PR" / "Validate before PR"

## Allowed Operations Without Explicit Request

- File reads, writes, edits
- Code exploration and search
- Running the application (`bun run dev`, `bun run start`)
- Building (`bun run build`) - only when user asks
- Git operations (status, diff, add, commit) - only when user asks

## Rationale

The user controls when validation runs. This avoids:
- Unnecessary wait times during development
- Noise from pre-existing lint/type errors unrelated to current changes
- Breaking flow with CI-like gates during iteration

The `open-pr` skill (when invoked) will handle the full validation pipeline.