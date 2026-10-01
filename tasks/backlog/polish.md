# Polish Backlog

Work here should improve existing user experience without introducing a new major capability.

## Candidate tasks

### Improve loading and empty states

**Goal:** Make existing screens feel more complete while data loads or when lists are empty.

**Scope**
- Guild/channel/message/friends views.
- Clear empty states and loading indicators.

**Out of scope**
- New backend features.

**Acceptance**
- Existing pages avoid confusing blank states during normal local usage.

### Improve notification and error feedback

**Goal:** Make API and realtime failures visible without blocking the UI.

**Scope**
- Existing notification toast system.
- Common API failure paths.

**Out of scope**
- Push notifications or notification preferences.

**Acceptance**
- Common failures produce user-visible feedback.

### Improve friend request send UX

**Goal:** Make the friend request flow more obvious and reassuring.

**Scope**
- Friend search / add friend UI.
- Clear button labels and selected-user state.
- Visible success/failure feedback after sending a request.

**Out of scope**
- Redesigning the whole friends page.
- New friend discovery features.

**Acceptance**
- A tester can clearly tell when a typed username resolved to a sendable user, when the request is being sent, and whether it succeeded or failed.

### Responsive layout cleanup

**Goal:** Improve usability on narrower screens.

**Scope**
- Existing app layout and sidebars.
- Preserve desktop layout behavior.

**Out of scope**
- Native mobile app work.

**Acceptance**
- Main views remain usable at common tablet/small-laptop widths.
