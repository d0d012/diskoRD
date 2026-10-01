# Infrastructure Backlog

Work here should improve local development, deployment, runtime operations, or environment management.

## Candidate tasks

### Add local dev bootstrap script

**Goal:** Make local startup easier and less error-prone.

**Scope**
- Start Docker Compose services.
- Document or script backend/frontend startup.
- Avoid hiding errors from individual processes.

**Out of scope**
- Changing production deployment architecture.

**Acceptance**
- A new contributor can start local services and app processes using documented commands.

### Add dev seed/demo users

**Goal:** Provide repeatable local accounts for manual testing.

**Scope**
- Script or documented command to create demo users.
- Must be safe for local development only.

**Out of scope**
- Production seed data.

**Acceptance**
- Two local test users can be created repeatably without manual API calls.

### Decide and document pgBouncer usage

**Goal:** Resolve whether pgBouncer belongs in this repository.

**Scope**
- If not used, keep docs free of pgBouncer claims.
- If used later, add actual compose/config support in the implementation task.

**Out of scope**
- Adding pgBouncer without a concrete deployment need.

**Acceptance**
- Documentation and infrastructure agree.

### Decide local coturn support

**Goal:** Resolve whether local Docker Compose should include coturn for WebRTC testing.

**Scope**
- Current code has coturn in production compose only.
- Decide whether local compose should stay simple or include coturn.

**Out of scope**
- Reworking LiveKit voice architecture.

**Acceptance**
- Documentation and compose files agree.
