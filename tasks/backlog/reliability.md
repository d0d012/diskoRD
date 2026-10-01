# Reliability Backlog

Work here should make existing behavior more correct, tested, and maintainable. Do not add new product capabilities in this file.

## Candidate tasks

### Fix frontend voice layout tests

**Goal:** Make `frontend/src/features/voice/voiceLayout.test.ts` and the current layout implementation agree.

**Scope**
- Review the failing test expectations against `voiceLayout.ts`.
- Update tests or implementation according to the intended current behavior.

**Out of scope**
- Redesigning the voice UI.

**Acceptance**
- `cd frontend && npm run test` passes.

### Reduce frontend lint warnings

**Goal:** Address React hook/ref warnings reported by ESLint where they indicate real maintainability issues.

**Scope**
- Hook dependency warnings.
- Ref reads during render.
- Synchronous setState-in-effect warnings where practical.

**Out of scope**
- Broad component rewrites.

**Acceptance**
- `cd frontend && npm run lint` has fewer warnings or no warnings.

### Add backend coverage for under-tested packages

**Goal:** Add focused tests for existing backend behavior.

**Scope**
- Prioritize gateway, message, friend, voice, role, channel, and invite packages.
- Keep tests table-driven where practical.

**Out of scope**
- Changing API behavior except to fix bugs discovered by tests.

**Acceptance**
- `cd backend && go test ./...` passes.

### Improve realtime state consistency

**Goal:** Existing friend, DM, and message flows should update without requiring refresh.

**Scope**
- Gateway event handling and frontend stores.
- Friend request state.
- Message state for active conversations.
- Realtime message edit/delete updates.
- DM sidebar state for first-ever DM messages.
- Unread state for inactive guild channels and DMs.

**Out of scope**
- Push notifications.
- Notification preferences.
- Gateway session resume.

**Acceptance**
- Friend requests, first-ever DMs, active messages, message deletions, and unread indicators update during two-account manual testing without refresh.

> Promoted to `tasks/active/001-fix-realtime-state-consistency.md`.
