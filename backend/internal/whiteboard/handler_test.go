package whiteboard

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testApp(h *harness, member bool) *fiber.App {
	if !member {
		h.svc = NewService(h.repo, fakeMembers{member: false}, h.ops)
	}
	app := fiber.New(fiber.Config{BodyLimit: 12 * 1024 * 1024, ErrorHandler: func(c *fiber.Ctx, err error) error {
		code, msg := fiber.StatusInternalServerError, "internal server error"
		if e, ok := err.(*fiber.Error); ok {
			code, msg = e.Code, e.Message
		}
		return c.Status(code).JSON(fiber.Map{"error": msg})
	}})
	auth := func(c *fiber.Ctx) error { c.Locals("userID", userID); return c.Next() }
	RegisterRoutes(app, NewHandler(h.svc), auth)
	return app
}

func do(t *testing.T, app *fiber.App, method, path, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var out map[string]any
	require.NoError(t, json.Unmarshal(b, &out), string(b))
	return resp.StatusCode, out
}

func TestHandlerGetBoardEnvelope(t *testing.T) {
	h := newHarness()
	app := testApp(h, true)

	status, body := do(t, app, "GET", "/channels/"+chID+"/board", "")
	assert.Equal(t, http.StatusOK, status)
	data := body["data"].(map[string]any)
	assert.EqualValues(t, 0, data["seq"])
	assert.Equal(t, []any{}, data["objects"])

	status, body = do(t, app, "GET", "/channels/not-a-uuid/board", "")
	assert.Equal(t, http.StatusBadRequest, status)
	assert.NotEmpty(t, body["error"])
	assert.NotContains(t, body, "data")

	status, _ = do(t, testApp(newHarness(), false), "GET", "/channels/"+chID+"/board", "")
	assert.Equal(t, http.StatusForbidden, status)
}

func TestHandlerOpsEnvelopes(t *testing.T) {
	h := newHarness()
	app := testApp(h, true)
	id := h.uuid()

	req := string(raw(CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{createChange(id, rectBody(id))}}))
	status, body := do(t, app, "POST", "/channels/"+chID+"/board/ops", req)
	assert.Equal(t, http.StatusOK, status)
	assert.Equal(t, map[string]any{"data": map[string]any{
		"seq":     float64(1),
		"changes": []any{map[string]any{"id": id, "action": "create", "version": float64(1)}},
	}}, body)

	stale := string(raw(CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{updateChange(id, 7, m{"x": 1})}}))
	status, body = do(t, app, "POST", "/channels/"+chID+"/board/ops", stale)
	assert.Equal(t, http.StatusConflict, status)
	assert.NotEmpty(t, body["error"])
	assert.Equal(t, "conflict", body["code"])
	assert.EqualValues(t, 1, body["seq"])
	current := body["current"].([]any)
	require.Len(t, current, 1)
	assert.Equal(t, id, current[0].(map[string]any)["id"])

	gone := h.uuid()
	req = string(raw(CommandRequest{OpID: h.uuid(), Changes: []ChangeRequest{deleteChange(gone, 1)}}))
	status, body = do(t, app, "POST", "/channels/"+chID+"/board/ops", req)
	assert.Equal(t, http.StatusConflict, status)
	assert.Equal(t, "gone", body["code"])
	assert.EqualValues(t, 1, body["seq"])
	assert.Equal(t, []any{}, body["current"])

	status, body = do(t, app, "POST", "/channels/"+chID+"/board/ops", `{not json`)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid request body", body["error"])

	status, body = do(t, app, "POST", "/channels/"+chID+"/board/ops", `{"opId":"`+h.uuid()+`","changes":[]}`)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.NotContains(t, body, "data")
}
