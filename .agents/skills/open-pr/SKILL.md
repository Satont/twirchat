---
name: open-pr
description: Prepare and open a pull request safely. Use when the user asks to open, create, submit, or update a PR, prepare a branch for review, or rebase a PR branch. Syncs the base branch, rebases the head branch, reruns checks, pushes with lease, and creates or updates the PR with a conventional title and test plan.
---

# Open a pull request

Follow this workflow when a branch is ready for review. Rebasing happens before the PR is
opened or updated, never after pushing a stale branch.

Quick sequence:

```bash
git fetch --prune <base-remote>
git rebase <base-remote>/<base-branch>
bun run fix && bun run check && bun run test
git push --force-with-lease <head-remote> HEAD:<branch>
gh pr create --base <base-branch> --title "<type>(<scope>): <summary>" --body-file <body>
```

The sections below explain how to choose the remotes and what to do when a step fails.

## 1. Inspect the repository

```bash
git status --short --branch
git remote -v
git branch --show-current
```

- Stop and ask the user if the working tree has uncommitted changes. Commit them following
  the commit rules in `AGENTS.md`, or stash them only with explicit approval. Never discard
  user changes.
- Use `main` as the default base branch. If the task targets `gpuix` or another branch, use
  that instead and state it in the PR.
- Never open a PR from `main` or `gpuix` itself.
- Identify the two remotes:
  - **base remote** — the canonical repository that owns the base branch. `origin`
    normally works. In a fork setup it may be a differently named remote (for example
    `twirchat` while `origin` is the fork).
  - **head remote** — the remote that accepts pushes for the feature branch, usually
    `origin`.
- If the naming is ambiguous, inspect `git remote -v` and `gh repo view --json nameWithOwner`
  before continuing.

## 2. Sync and rebase

```bash
git fetch --prune <base-remote>
git rebase <base-remote>/<base-branch>
```

- Resolve conflicts using the policy below, then continue with `git rebase --continue`.
- Confirm the branch now sits on the latest base and contains only intended commits:

```bash
git log --oneline <base-remote>/<base-branch>..HEAD
git diff --stat <base-remote>/<base-branch>...HEAD
```

- If the branch is shared with other people, or the user did not ask for history rewriting,
  ask before rebasing. Never rebase or force-push `main`, `gpuix`, or someone else's branch.

### Conflict resolution policy

The canonical base branch is the source of truth. Upstream changes take priority, and the
feature branch is integrated on top of them — never the other way around.

Rules:

- Treat the canonical base branch as the source of truth for existing code, architecture,
  APIs, and conventions.
- Preserve upstream changes whenever both branches modify the same code.
- Reapply feature branch functionality on top of upstream changes.
- Do not blindly choose `--ours` or `--theirs`. During a rebase their meaning is inverted:
  `--ours` is the upstream base commit, `--theirs` is the feature commit being replayed.
- Understand the intent of both conflicting changes before resolving the conflict.
- Never silently discard feature branch functionality.
- If the correct resolution is ambiguous, abort with `git rebase --abort` and ask the user.

After resolving conflicts:

- Review the resolved diff before `git rebase --continue` (`git diff` for staged hunks, and
  `git diff <base-remote>/<base-branch>...HEAD` once the rebase finishes).
- Ensure both upstream changes and the intended feature functionality are preserved.
- Run the relevant tests from step 3 before continuing.

## 3. Rerun checks after the rebase

Run the project gates from `AGENTS.md`, at minimum:

```bash
bun run fix
bun run check
bun run test
```

- If `bun.lock` changed during the rebase, run `bun install --frozen-lockfile` first.
- Run focused package tests, benchmarks, or `qa:gui` checks when the change touches those
  areas. The performance and GUI gates in `AGENTS.md` are part of PR readiness.
- Review the final diff with the `deslop` skill before opening the PR.

## 4. Push the rebased branch

```bash
git push --force-with-lease <head-remote> HEAD:<branch>
```

- Use `--force-with-lease`, never plain `--force`. If the lease is rejected, fetch and
  inspect what changed instead of overriding it.
- Use `git push -u <head-remote> HEAD:<branch>` when the branch has no upstream yet.
- Pushing an update to an existing PR is enough to refresh it; do not create a duplicate PR.

## 5. Create or update the PR

Check whether a PR already exists:

```bash
gh pr list --head <branch> --json number,url,state
```

If it does not exist, create it:

```bash
gh pr create \
  --base <base-branch> \
  --head <head-owner>:<branch> \
  --title "<type>(<scope>): <summary>" \
  --body-file <body-file>
```

Title rules come from `AGENTS.md` and the `PR title` workflow: `type(scope)!: summary`, with
an allowed type (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`). Keep it imperative and concise; it becomes the squash commit subject.

Use a body with at least:

```markdown
## Summary

- What changed and why.

## Testing

- [ ] `bun run check`
- [ ] `bun run test`
- [ ] Other focused checks, benchmarks, or GUI runs.
```

Add `Closes #<issue>` when the PR resolves an issue. If the PR already exists, update only
what changed:

```bash
gh pr edit <number> --title "<title>" --body-file <body-file>
```

## 6. Verify the PR

```bash
gh pr view --json number,url,title,baseRefName,headRefName,mergeable,statusCheckRollup
gh pr checks --watch
```

Report the URL, title, base and head branches, and check status. Do not call the PR ready
while a required check is failing. If a check fails, fix the branch and repeat from step 2;
do not disable the check or drop coverage to make the PR pass.

## Guardrails

- Update the base branch and rebase before opening or updating the PR.
- Resolve rebase conflicts in favor of the canonical base branch, then reapply the feature
  branch functionality on top.
- Keep the PR head branch equal to the reviewed local branch; do not push unrelated commits.
- Never commit secrets, generated artifacts, or benchmark output that is not meant to be
  tracked.
- Do not merge the PR unless the user explicitly asks. Squash merge and keep the PR title
  as the squash commit subject.
