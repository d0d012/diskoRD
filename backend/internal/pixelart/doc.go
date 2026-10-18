// Package pixelart validates the indexed-color pixel art documents produced by
// the frontend editor (frontend/src/features/pixelart/lib/doc.ts).
package pixelart

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const (
	// MaxDocBytes bounds the raw JSON of one document (a 256×256 frame is ~87 KB of base64).
	MaxDocBytes = 128 * 1024
	MaxColors   = 64
	MaxFrames   = 8
	// MaxPixels bounds width*height*frames, so big canvases can't also carry many frames.
	MaxPixels = 256 * 256
)

var (
	allowedSizes = map[int]bool{16: true, 32: true, 64: true, 128: true, 256: true}
	hexColor     = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
)

// Doc is a pixel art document. Pixel value k refers to Palette[k-1]; 0 is transparent.
type Doc struct {
	V       int      `json:"v"`
	Width   int      `json:"width"`
	Height  int      `json:"height"`
	Palette []string `json:"palette"`
	// Frames are base64 strings of Width*Height palette indices each.
	Frames []string `json:"frames"`
}

func invalid(msg string) error {
	return fiber.NewError(fiber.StatusBadRequest, "invalid pixel art: "+msg)
}

// Validate parses raw, checks every structural rule and returns the document
// re-encoded canonically (unknown fields dropped, colors lowercased).
func Validate(raw []byte) (json.RawMessage, error) {
	if len(raw) == 0 || len(raw) > MaxDocBytes {
		return nil, invalid("missing or too large")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	var doc Doc
	if err := dec.Decode(&doc); err != nil {
		return nil, invalid("malformed")
	}
	if doc.V != 1 {
		return nil, invalid("unsupported version")
	}
	if doc.Width != doc.Height || !allowedSizes[doc.Width] {
		return nil, invalid("unsupported size")
	}
	if len(doc.Palette) < 1 || len(doc.Palette) > MaxColors {
		return nil, invalid("palette must have 1 to 64 colors")
	}
	for i, c := range doc.Palette {
		if !hexColor.MatchString(c) {
			return nil, invalid("bad color")
		}
		doc.Palette[i] = strings.ToLower(c)
	}
	if len(doc.Frames) < 1 || len(doc.Frames) > MaxFrames {
		return nil, invalid("must have 1 to 8 frames")
	}
	if doc.Width*doc.Height*len(doc.Frames) > MaxPixels {
		return nil, invalid("too many pixels")
	}
	for _, frame := range doc.Frames {
		pixels, err := base64.StdEncoding.DecodeString(frame)
		if err != nil || len(pixels) != doc.Width*doc.Height {
			return nil, invalid("corrupt pixel data")
		}
		for _, p := range pixels {
			if int(p) > len(doc.Palette) {
				return nil, invalid("pixel refers to a missing color")
			}
		}
	}
	out, err := json.Marshal(doc)
	if err != nil {
		return nil, invalid("malformed")
	}
	return out, nil
}
