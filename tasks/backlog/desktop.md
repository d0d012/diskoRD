# Desktop Backlog

Work here should be specific to the Tauri desktop shell under `frontend/src-tauri/`.

## Candidate tasks

### Verify desktop packaging

**Goal:** Ensure the existing Tauri app packages cleanly for supported platforms.

**Scope**
- Tauri build configuration.
- Release artifact sanity checks.

**Out of scope**
- New desktop-only product features.

**Acceptance**
- Tauri build command succeeds on the target development platform.

### Review updater flow

**Goal:** Validate that the current updater integration behaves correctly.

**Scope**
- Frontend updater hook/UI.
- Tauri updater configuration.

**Out of scope**
- Redesigning release infrastructure.

**Acceptance**
- Update availability and install/restart behavior are documented or tested.

### Native desktop polish

**Goal:** Improve native app behavior where web behavior is insufficient.

**Scope**
- Tray behavior, native notifications, app permissions, window behavior.

**Out of scope**
- Changes to backend APIs.

**Acceptance**
- Each native behavior has its own active task before implementation.
