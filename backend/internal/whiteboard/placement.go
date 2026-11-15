package whiteboard

import (
	"encoding/json"
	"fmt"
	"math"
)

// Rect is an axis-aligned world-space rectangle. Zero extents are allowed.
type Rect struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

func (r *Rect) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for _, f := range []struct {
		name string
		dest *float64
	}{{"x", &r.X}, {"y", &r.Y}, {"w", &r.W}, {"h", &r.H}} {
		v, err := decodeNumber(fields[f.name])
		if err != nil {
			return fmt.Errorf("whiteboard.Rect: %s: %w", f.name, err)
		}
		*f.dest = v
	}
	return r.validate()
}

func (r Rect) validate() error {
	for _, v := range []float64{r.X, r.Y, r.W, r.H, r.X + r.W, r.Y + r.H} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return invalidf("rect must have finite coordinates and extents")
		}
	}
	if r.W < 0 || r.H < 0 {
		return invalidf("rect extents must be nonnegative")
	}
	return nil
}

type bounds struct {
	minX, minY, maxX, maxY float64
}

func extendBounds(b *bounds, r Rect) *bounds {
	n := bounds{r.X, r.Y, r.X + r.W, r.Y + r.H}
	if b == nil {
		return &n
	}
	b.minX, b.minY = math.Min(b.minX, n.minX), math.Min(b.minY, n.minY)
	b.maxX, b.maxY = math.Max(b.maxX, n.maxX), math.Max(b.maxY, n.maxY)
	return b
}

func (b bounds) containsWithMargin(n bounds, margin float64) bool {
	return n.minX >= b.minX-margin && n.minY >= b.minY-margin &&
		n.maxX <= b.maxX+margin && n.maxY <= b.maxY+margin
}
