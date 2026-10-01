# Tasks

This directory is the lightweight task system for diskoRD. Keep task files small, scoped, and actionable.

## Structure

```txt
tasks/
  active/      # tasks ready to implement now
  backlog/     # grouped future cleanup/polish/reliability/infra work
  features/    # brand-new user-visible capabilities
  archive/     # older phase-based task specs kept for reference
```

## Where to put work

- Use `active/` for work that is ready to be picked up immediately.
- Use `features/` for brand-new capabilities, e.g. message search, unread tracking, audit logs.
- Use `backlog/` for grouped non-feature work, e.g. polish, reliability, infrastructure, desktop hardening.
- Use `archive/` only for historical task specs. Do not add new work there.

## Naming

### Active tasks

Use a numeric prefix so execution order is obvious:

```txt
active/001-fix-voice-tests.md
active/002-add-dev-seed-users.md
```

### Feature specs

Use `kebab-case` named after the capability:

```txt
features/message-search.md
features/unread-tracking.md
features/audit-log.md
```

### Backlog groups

Use broad, stable categories:

```txt
backlog/polish.md
backlog/reliability.md
backlog/infrastructure.md
backlog/desktop.md
```

## Task template

```md
# Task: Short imperative title

## Goal

One or two sentences describing the outcome.

## Scope

- What should be changed
- What files/areas are likely involved

## Out of scope

- What should not be changed
- Product decisions that should be deferred

## Acceptance

- Command/output or behavior that proves the task is done
- Tests/build/lint expectations when applicable
```

## Boundary rules

- A task should have one primary reason to change the codebase.
- Do not mix unrelated backend, frontend, and infrastructure work unless they are required for one feature.
- Prefer one feature file for a new capability; split only when the file becomes too large to execute safely.
- Move a task from `features/` or `backlog/` into `active/` only when it is ready to implement.
