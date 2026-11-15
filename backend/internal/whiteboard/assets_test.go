package whiteboard

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"hash/crc32"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/d0d012/diskord/internal/storage"
	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func encodedImage(t *testing.T, format string) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	var b bytes.Buffer
	var err error
	switch format {
	case "png":
		err = png.Encode(&b, img)
	case "jpeg":
		err = jpeg.Encode(&b, img, nil)
	case "gif":
		err = gif.Encode(&b, img, nil)
	default:
		t.Fatalf("unknown test format %s", format)
	}
	require.NoError(t, err)
	return b.Bytes()
}

func uploadRequest(t *testing.T, data []byte, field string) (*bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	// Lie about both filename and MIME: content sniffing must win.
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", `form-data; name="`+field+`"; filename="not-an-image.svg"`)
	h.Set("Content-Type", "image/svg+xml")
	part, err := w.CreatePart(h)
	require.NoError(t, err)
	_, err = part.Write(data)
	require.NoError(t, err)
	require.NoError(t, w.Close())
	return &body, w.FormDataContentType()
}

func postAsset(t *testing.T, app *fiber.App, channel string, data []byte, field string) (int, map[string]any) {
	t.Helper()
	body, contentType := uploadRequest(t, data, field)
	req := httptest.NewRequest("POST", "/channels/"+channel+"/board/assets", body)
	req.Header.Set("Content-Type", contentType)
	resp, err := app.Test(req, -1)
	require.NoError(t, err)
	defer resp.Body.Close()
	var result map[string]any
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&result))
	return resp.StatusCode, result
}

func assetHarness(t *testing.T, baseURL string) (*harness, string) {
	t.Helper()
	h := newHarness()
	dir := t.TempDir()
	h.svc.SetStorage(storage.NewService(dir, baseURL))
	return h, dir
}

func filesUnder(t *testing.T, dir string) []string {
	t.Helper()
	var files []string
	require.NoError(t, filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			files = append(files, path)
		}
		return nil
	}))
	return files
}

func TestAssetUploadHappyPath(t *testing.T) {
	for _, format := range []string{"png", "jpeg", "gif"} {
		for _, base := range []string{"", "http://localhost:3000"} {
			t.Run(format+base, func(t *testing.T) {
				h, dir := assetHarness(t, base)
				input := encodedImage(t, format)
				status, body := postAsset(t, testApp(h, true), chID, input, "file")
				require.Equal(t, 201, status, body)
				data := body["data"].(map[string]any)
				require.Len(t, data, 4)
				id := data["id"].(string)
				assert.True(t, isUUID(id))
				assert.EqualValues(t, 3, data["width"])
				assert.EqualValues(t, 2, data["height"])
				a := h.repo.assets[id]
				assert.Equal(t, chID, a.BoardID)
				assert.Equal(t, userID, a.UploadedBy)
				assert.Equal(t, "image/"+format, a.MIME)
				assert.Equal(t, len(input), a.Bytes)
				assert.True(t, strings.HasPrefix(a.StorageKey, "board-assets/"+chID+"/"))
				assert.Equal(t, base+"/uploads/"+a.StorageKey, data["url"])
				saved, err := os.ReadFile(filepath.Join(dir, a.StorageKey))
				require.NoError(t, err)
				assert.Equal(t, input, saved)
				assert.Zero(t, h.repo.seq)
				assert.Empty(t, h.pub.payloads)
				images, err := h.svc.storage.ListMessageImages()
				require.NoError(t, err)
				assert.Empty(t, images, "attachment backfill must ignore board assets")
			})
		}
	}
}

func pngHeaderWithSize(t *testing.T, w, h uint32) []byte {
	b := append([]byte(nil), encodedImage(t, "png")...)
	binary.BigEndian.PutUint32(b[16:20], w)
	binary.BigEndian.PutUint32(b[20:24], h)
	binary.BigEndian.PutUint32(b[29:33], crc32.ChecksumIEEE(b[12:29]))
	return b
}

func TestAssetUploadRejections(t *testing.T) {
	for _, tc := range []struct {
		name   string
		data   []byte
		status int
		setup  func(*harness)
	}{
		{"SVG", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), 400, nil},
		{"non image", []byte("hello"), 400, nil},
		{"undecodable", encodedImage(t, "png")[:33], 400, nil},
		{"WebP", []byte("RIFF\x10\x00\x00\x00WEBPVP8 " + strings.Repeat("\x00", 16)), 400, nil},
		{"too many bytes", make([]byte, MaxImageBytes+1), 413, nil},
		{"too many pixels", pngHeaderWithSize(t, 4001, 4000), 413, nil},
		{"too wide", pngHeaderWithSize(t, maxImageDim+1, 1), 413, nil},
		{"nonmember", encodedImage(t, "png"), 403, func(h *harness) { h.svc.members = fakeMembers{false} }},
		{"text channel", encodedImage(t, "png"), 404, func(h *harness) { h.repo.channels[chID].Type = "text" }},
		{"voice channel", encodedImage(t, "png"), 404, func(h *harness) { h.repo.channels[chID].Type = "voice" }},
		{"missing channel", encodedImage(t, "png"), 404, func(h *harness) { delete(h.repo.channels, chID) }},
		{"quota", encodedImage(t, "png"), 413, func(h *harness) { seedReferencedAssets(h, MaxReferencedAssetsPerBoard) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, dir := assetHarness(t, "")
			if tc.setup != nil {
				tc.setup(h)
			}
			status, body := postAsset(t, testApp(h, true), chID, tc.data, "file")
			require.Equal(t, tc.status, status, body)
			assert.Len(t, body, 1)
			assert.NotEmpty(t, body["error"])
			if tc.name == "WebP" {
				assert.Contains(t, body["error"], "WebP")
			}
			assert.Empty(t, filesUnder(t, dir))
		})
	}
	h, _ := assetHarness(t, "")
	status, _ := postAsset(t, testApp(h, true), chID, encodedImage(t, "png"), "wrong-field")
	assert.Equal(t, 400, status)
}

func TestAssetUploadCleansFileOnDatabaseFailure(t *testing.T) {
	for _, stage := range []string{"insert", "commit"} {
		t.Run(stage, func(t *testing.T) {
			h, dir := assetHarness(t, "")
			secret := errors.New("pq: secret database internals")
			if stage == "insert" {
				h.repo.failAsset = secret
			} else {
				h.repo.failCommit = secret
			}
			status, body := postAsset(t, testApp(h, true), chID, encodedImage(t, "png"), "file")
			assert.Equal(t, 500, status)
			assert.Equal(t, "internal server error", body["error"])
			assert.Empty(t, filesUnder(t, dir))
			assert.Empty(t, h.repo.assets)
		})
	}
}

func assetImage(id string, a Asset, base string) m {
	return m{"id": id, "kind": "image", "rank": "1:a0", "version": 0, "createdBy": userID,
		"x": 0, "y": 0, "w": 64, "h": 64, "assetId": a.ID, "url": base + "/uploads/" + a.StorageKey,
		"width": a.Width, "height": a.Height, "crop": m{"x": 0, "y": 0, "w": 1, "h": 1}, "pixelated": false}
}

func seedAsset(h *harness) Asset {
	id := h.uuid()
	a := Asset{ID: id, BoardID: chID, StorageKey: "board-assets/" + chID + "/" + id + ".png", Width: 3, Height: 2}
	h.repo.assets[id] = a
	return a
}

func seedReferencedAssets(h *harness, count int) {
	for i := 0; i < count; i++ {
		a := seedAsset(h)
		id := h.uuid()
		b := assetImage(id, a, "")
		delete(b, "id")
		delete(b, "version")
		body := raw(b)
		h.repo.objects[id] = Object{ID: id, Version: 1, Body: body}
		h.repo.objectCount++
		h.repo.bodyBytes += int64(len(body))
	}
}

func TestImageMetadataValidationOnCreateAndUpdate(t *testing.T) {
	for _, base := range []string{"", "http://localhost:3000"} {
		for _, field := range []string{"url", "width", "height", "foreign asset"} {
			t.Run(base+field, func(t *testing.T) {
				h, _ := assetHarness(t, base)
				a := seedAsset(h)
				id := h.uuid()
				good := assetImage(id, a, base)
				_, err := h.run(createChange(id, good))
				require.NoError(t, err)
				patch := m{}
				switch field {
				case "url":
					patch[field] = "https://untrusted.example/image.png"
				case "width":
					patch[field] = a.Width + 1
				case "height":
					patch[field] = a.Height + 1
				case "foreign asset":
					foreign := seedAsset(h)
					foreign.BoardID = guild
					h.repo.assets[foreign.ID] = foreign
					patch["assetId"] = foreign.ID
					patch["url"] = base + "/uploads/" + foreign.StorageKey
				}
				_, err = h.run(updateChange(id, 1, patch))
				assert.Equal(t, 400, httpCode(t, err))
				newID := h.uuid()
				bad := assetImage(newID, a, base)
				for k, v := range patch {
					bad[k] = v
				}
				_, err = h.run(createChange(newID, bad))
				assert.Equal(t, 400, httpCode(t, err))
				assert.EqualValues(t, 1, h.repo.seq)
				assert.Len(t, h.repo.objects, 1)
				// Geometry/crop patches still validate against the unchanged asset.
				_, err = h.run(updateChange(id, 1, m{"crop": m{"x": 0.1, "y": 0, "w": 0.9, "h": 1}}))
				require.NoError(t, err)
			})
		}
	}
}

func TestReferencedAssetQuotaCannotBeBypassedByPreuploads(t *testing.T) {
	h, _ := assetHarness(t, "")
	seedReferencedAssets(h, MaxReferencedAssetsPerBoard)
	newAsset := seedAsset(h)
	id := h.uuid()
	_, err := h.run(createChange(id, assetImage(id, newAsset, "")))
	assert.Equal(t, 413, httpCode(t, err))
	assert.Len(t, h.repo.objects, MaxReferencedAssetsPerBoard)
	// An atomic replacement frees its previous asset; quota sees final state.
	var victim string
	for key := range h.repo.objects {
		victim = key
		break
	}
	_, err = h.run(deleteChange(victim, 1), createChange(id, assetImage(id, newAsset, "")))
	require.NoError(t, err)
	// Duplicating an existing asset does not consume another slot.
	duplicate := h.uuid()
	_, err = h.run(createChange(duplicate, assetImage(duplicate, newAsset, "")))
	require.NoError(t, err)
	assert.Len(t, h.repo.objects, MaxReferencedAssetsPerBoard+1)
}

func TestUnusedAssetsDoNotConsumeUploadQuota(t *testing.T) {
	h, _ := assetHarness(t, "")
	// No live object references these rows. Age is irrelevant: even >24h-old
	// unused rows can never permanently exhaust the referenced-asset quota.
	for i := 0; i < MaxReferencedAssetsPerBoard+10; i++ {
		seedAsset(h)
	}
	status, body := postAsset(t, testApp(h, true), chID, encodedImage(t, "png"), "file")
	require.Equal(t, 201, status, body)
	assert.Len(t, h.repo.assets, MaxReferencedAssetsPerBoard+11)
}

func TestUploadRateLimitHTTPAndSlidingWindow(t *testing.T) {
	h, _ := assetHarness(t, "")
	app := testApp(h, true)
	for i := 0; i < MaxUploadsPerMinute; i++ {
		status, body := postAsset(t, app, chID, encodedImage(t, "png"), "file")
		require.Equal(t, 201, status, body)
	}
	// Different path/channel cannot evade the per-user limiter.
	status, body := postAsset(t, app, guild, encodedImage(t, "png"), "file")
	assert.Equal(t, 429, status)
	assert.Len(t, body, 1)
	assert.NotEmpty(t, body["error"])
	l := newUploadLimiter()
	now := time.Unix(1000, 0)
	l.now = func() time.Time { return now }
	for i := 0; i < MaxUploadsPerMinute; i++ {
		require.True(t, l.allow(userID))
	}
	assert.False(t, l.allow(userID))
	assert.True(t, l.allow("another user"))
	now = now.Add(UploadRateWindow - time.Nanosecond)
	assert.False(t, l.allow(userID))
	now = now.Add(time.Nanosecond)
	assert.True(t, l.allow(userID))
	now = now.Add(2 * UploadRateWindow)
	assert.True(t, l.allow("new user"))
	assert.Len(t, l.users, 1, "idle entries are swept")
}

func TestUploadRequiresAuthentication(t *testing.T) {
	h, _ := assetHarness(t, "")
	app := fiber.New(fiber.Config{ErrorHandler: func(c *fiber.Ctx, err error) error {
		return c.Status(401).JSON(fiber.Map{"error": "unauthorized"})
	}})
	RegisterRoutes(app, NewHandler(h.svc), func(*fiber.Ctx) error { return fiber.ErrUnauthorized })
	status, body := postAsset(t, app, chID, encodedImage(t, "png"), "file")
	assert.Equal(t, 401, status)
	assert.NotEmpty(t, body["error"])
	assert.Empty(t, h.repo.assets)
}

func TestUploadBoundedReader(t *testing.T) {
	h, dir := assetHarness(t, "")
	input := strings.NewReader(strings.Repeat("x", MaxImageBytes+100))
	_, err := h.svc.UploadAsset(context.Background(), userID, chID, input)
	assert.Equal(t, 413, httpCode(t, err))
	remaining, err := io.ReadAll(input)
	require.NoError(t, err)
	assert.Len(t, remaining, 99)
	assert.Empty(t, filesUnder(t, dir))
}

// Production runs with an empty storage baseURL, so the client receives a
// relative "/uploads/..." URL. Creating the image object with exactly that URL
// must succeed; the desktop client resolves it against the API origin for
// display only, and storing the resolved absolute URL would be rejected.
func TestUploadedAssetURLRoundTripsIntoImageCreate(t *testing.T) {
	for _, base := range []string{"", "http://localhost:3000"} {
		t.Run("base="+base, func(t *testing.T) {
			h, _ := assetHarness(t, base)
			status, body := postAsset(t, testApp(h, true), chID, encodedImage(t, "png"), "file")
			require.Equal(t, 201, status, body)
			data := body["data"].(map[string]any)
			url := data["url"].(string)
			if base == "" {
				assert.True(t, strings.HasPrefix(url, "/uploads/board-assets/"+chID+"/"), url)
			}
			id := h.uuid()
			image := m{"id": id, "kind": "image", "rank": "1:a0", "version": 0, "createdBy": userID,
				"x": 0, "y": 0, "w": 64, "h": 64, "assetId": data["id"], "url": url,
				"width": data["width"], "height": data["height"], "crop": m{"x": 0, "y": 0, "w": 1, "h": 1}, "pixelated": false}
			_, err := h.run(createChange(id, image))
			require.NoError(t, err)

			if base == "" {
				resolved := h.uuid()
				image["id"] = resolved
				image["url"] = "https://diskord.example.com" + url
				_, err = h.run(createChange(resolved, image))
				assert.Equal(t, 400, httpCode(t, err), "a display-resolved URL must not be accepted as the stored url")
			}
		})
	}
}
