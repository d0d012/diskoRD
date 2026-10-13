# Task: Message context menu, stable hover, and correct reactions

## Goal

1. Reactions store and display the real emoji (today 💪 becomes a `%F0%9F%92%AA` chip) and counts stay correct for every client.
2. Message actions (react, edit, copy, delete) move to a right-click context menu. Hovering a message only highlights it — the layout never moves.

## Already done (do NOT redo)

Migration `backend/migrations/000018_decode_percent_encoded_reactions.{up,down}.sql` is written and tested. It decodes existing `%XX`-only emoji rows in `message_reactions` and removes encoded rows whose decoded twin already exists. **Do not create or edit migrations**; write blockers into "Open questions" at the bottom.

---

## Part A — Reactions bug

### Root cause (verified)

- `frontend/src/stores/messageStore.ts:253,257` puts the raw emoji into the URL path: `` `/messages/${id}/reactions/${emoji}` ``. The browser percent-encodes it.
- Fiber does not unescape route params by default, so `c.Params("emoji")` in `backend/internal/reaction/handler.go:18,35` returns `%F0%9F%92%AA` and that string is stored.
- The optimistic chip uses the real emoji while the `REACTION_ADD` echo carries the encoded one, so the UI shows two chips (`💪 1` and `%F0%9F%92%AA 1`). After reload only the broken one remains.
- Secondary: `REACTION_ADD` carries no count, and `useGateway.ts:182` uses `count: d.count || 1`, which **overwrites** an existing count with 1 (4th person reacts → others see `1`).
- Secondary: encoded multi-codepoint emoji (e.g. 👨‍👩‍👧 = 54 encoded chars) exceed `VARCHAR(32)` and fail with a 500.

### Backend (`backend/internal/reaction`)

- In `Add` and `Remove` handlers: `emoji, err := url.PathUnescape(c.Params("emoji"))`; 400 on error.
- Validate in the service (so it is unit-testable): not empty, at most 32 runes, valid UTF-8, no ASCII control characters, and must not be plain ASCII text (reject `"abc"`, `"<script>"`). A simple rule is fine: every rune must be ≥ U+00A9 or one of the emoji modifiers/ZWJ/VS16 (U+200D, U+FE0F, U+20E3, digits/`#`/`*` only when followed by U+FE0F/U+20E3). 400 `"invalid emoji"` otherwise.
- `ReactionEvent` gains `Count int` (`json:"count"`): the total number of reactions for that emoji on that message **after** the change, read in the same request (add a repo method `CountForEmoji(ctx, messageID, emoji)`). Send it for both `REACTION_ADD` and `REACTION_REMOVE`.
- Tests (testify, mocks at the repository boundary — introduce a small repository interface in the service if needed): encoded input is decoded by the handler; validation rejects ASCII text / overlong / empty; event carries the server count.

### Frontend

- `messageStore.toggleReaction`: use `encodeURIComponent(emoji)` in both URLs. On API failure, **revert** the optimistic change (re-add or re-remove) instead of only logging.
- Gateway `REACTION_ADD` / `REACTION_REMOVE`: set the chip's `count` to the server `count` (remove the chip when `count` is 0). Only toggle `selfReacted` when `d.userId === me.id`. Never derive counts by ±1 from gateway events.
- The optimistic update and the echo of your own reaction must converge to one chip with the right count (the echo just confirms `count`).
- Tests (Vitest): toggle encodes the URL; failed request reverts; `REACTION_ADD` from another user with `count: 4` sets 4 and keeps `selfReacted`; `REACTION_REMOVE` with `count: 0` removes the chip.

---

## Part B — Context menu and stable hover

### Root cause of the layout jump (verified)

In `frontend/src/features/message/MessageItem.tsx:184-189`, when a message has no reactions, hovering inserts `<AddReactionButton>` **into the normal flow** under the message (`mt-1` + button height ≈ 28px). The message grows and everything below jumps. The edit/delete toolbar (`:193`) is absolutely positioned and is not the culprit, but it is being replaced anyway.

### Hover

- Hover keeps only the background highlight (and the existing timestamp reveal, which already uses `invisible`/`visible` and reserves its space).
- Remove the hover-only `AddReactionButton` and the hover action toolbar. Nothing may be added to or removed from layout on hover. Verify by hovering a message with no reactions: its height must not change.
- When a message **has** reactions, keep the reaction row with the trailing `+` button exactly as today (it is always rendered, so it does not shift).

### Context menu (new `features/message/MessageContextMenu.tsx`)

Opens on `contextmenu` over a message row (`e.preventDefault()`), positioned at the cursor and clamped inside the viewport (8px margin; flip up/left near edges, measure real size in `useLayoutEffect`). Also opens with the keyboard context-menu key / Shift+F10 when a message row is focused (make rows focusable with `tabIndex={-1}` on click is enough; full keyboard navigation of the message list is out of scope).

Exception: if the user right-clicks while there is a non-empty text selection inside the message, or on a link (`a[href]`) or an image, do **not** open our menu — let the browser's native menu handle copy / open link / save image.

Items, top to bottom:

1. **Quick reactions row** — 5 emoji buttons: the user's most recently used reactions (store last used in `localStorage` via `settingsStore`, max 5, wrapped in try/catch), falling back to `👍 ❤️ 😂 😮 😢`. Clicking toggles that reaction (same `toggleReaction`) and closes the menu. Last button `…` opens the existing emoji picker (reuse what `AddReactionButton` opens) anchored to the menu position.
2. **Add Reaction** → opens the emoji picker.
3. divider
4. **Edit Message** — only for own messages; enters the existing inline edit mode.
5. **Copy Text** — `navigator.clipboard.writeText(message.content)`; hidden when content is empty (attachment-only messages).
6. **Copy Message Link**? — out of scope; do not add.
7. divider
8. **Delete Message** (red) — shown for own messages, and for any message in a guild where the viewer is the guild **owner** (this mirrors the backend rule in `backend/internal/message/service.go:210-217`). Opens a confirm dialog ("Delete Message" / "Are you sure you want to delete this message?" + message preview, Cancel / Delete). **Shift+click** on the item deletes immediately without the dialog (show a tooltip hint "Hold Shift to skip confirmation"). Esc closes the dialog.

Behaviour:
- Only one menu open at a time app-wide (a tiny Zustand slice or module-level state is fine). Opening another message's menu closes the previous one.
- Closes on: item click, outside mousedown, Esc, window blur, scroll of the message list, and when the message is deleted/edited remotely.
- While the menu is open, the target message keeps its hover highlight.
- Arrow Up/Down move focus between items, Enter activates, Home/End jump. `role="menu"`, items `role="menuitem"`, the reaction buttons have `aria-label`s.
- Visual: `--color-dc-bg-floating`, radius 8, padding 6, min-width 200px, items 32px tall with 13px text, hover uses `--color-dc-brand` background with white text (danger item hover uses `--color-dc-red`). Icons on the right side of each item, 16px. 100ms fade/scale-in, respect `prefers-reduced-motion`.
- Works in DMs and guild channels.

### Tests (Vitest + RTL)

- Hovering a message without reactions does not render the add-reaction button (layout-stability regression).
- Right-click opens the menu; Edit/Delete visible only when allowed (own message; guild owner for others; DM other-user message → no Delete).
- Delete asks for confirmation; Shift+click deletes without the dialog.
- Quick reaction click calls `toggleReaction` and closes the menu.
- Right-click with a text selection does not open the menu.

---

## Out of scope

- Reply, pin, threads, message links, "mark unread".
- Emoji picker redesign.
- Long-press / touch support.
- Moderator/admin delete permissions (backend only allows author or guild owner today).

## Rollout

1. Apply migration `000018` (repo owner does this).
2. Deploy backend before or together with the frontend: the old frontend sends un-encoded paths that the new backend still decodes correctly, so order is not critical, but the count fix needs both.

## Acceptance

- React 💪 on a message → exactly one `💪 1` chip, for you and in another client; after reload still `💪 1`. DB `message_reactions.emoji` contains `💪`.
- Three users react 👍 → everyone sees `👍 3`; one removes → everyone sees `👍 2`.
- `PUT /messages/:id/reactions/abc` → 400.
- Hovering any message never changes its height or moves messages below it.
- Right-click on a message shows the menu at the cursor; all items work; menu stays on-screen near edges; native menu still appears for selected text, links and images.
- `go test ./...`, `npm run lint`, `npm run test` pass.

## Open questions

(Implementer: add anything here that blocks you instead of changing scope or the schema.)

- No schema change was needed; migration `000018` covered everything.
- `Reaction` (the aggregated read model) and `ReactionEvent` now both carry `count`; the event count is read from the DB in the same request via `CountForEmoji`.
- Message reads (`List`, and the response from `Edit`) now aggregate `message_reactions` for the viewer (`message.Repository.GetReactionsForMessages`), which is what makes persisted reactions reappear after a reload.
- The mutate → count → publish sequence is serialised **in-process** per `(message, emoji)` (`reaction.Service.lock`). A multi-instance deployment could still publish a stale count if two instances handle the same emoji concurrently; a distributed lock or DB-side ordering would be needed to close that fully.
