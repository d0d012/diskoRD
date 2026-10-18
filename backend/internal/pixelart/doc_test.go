package pixelart

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func frame(size int, fill byte) string {
	return base64.StdEncoding.EncodeToString([]byte(strings.Repeat(string([]byte{fill}), size*size)))
}

func docJSON(t *testing.T, mutate func(d map[string]any)) []byte {
	t.Helper()
	d := map[string]any{
		"v": 1, "width": 16, "height": 16,
		"palette": []string{"#FF0000", "#00ff00"},
		"frames":  []string{frame(16, 2)},
	}
	if mutate != nil {
		mutate(d)
	}
	raw, err := json.Marshal(d)
	require.NoError(t, err)
	return raw
}

func TestValidateAcceptsAndNormalizes(t *testing.T) {
	out, err := Validate(docJSON(t, func(d map[string]any) { d["extra"] = "dropped" }))
	require.NoError(t, err)

	var doc Doc
	require.NoError(t, json.Unmarshal(out, &doc))
	assert.Equal(t, []string{"#ff0000", "#00ff00"}, doc.Palette)
	assert.NotContains(t, string(out), "extra")
}

func TestValidateRejects(t *testing.T) {
	cases := map[string]func(d map[string]any){
		"wrong version":    func(d map[string]any) { d["v"] = 2 },
		"non-square":       func(d map[string]any) { d["height"] = 32 },
		"unsupported size": func(d map[string]any) { d["width"], d["height"] = 512, 512 },
		"empty palette":    func(d map[string]any) { d["palette"] = []string{} },
		"too many colors":  func(d map[string]any) { d["palette"] = make([]string, 65) },
		"too many pixels": func(d map[string]any) {
			// 128×128×5 frames is over the pixel budget but under the byte limit.
			d["width"], d["height"] = 128, 128
			f := frame(128, 1)
			d["frames"] = []string{f, f, f, f, f}
		},
		"bad color":          func(d map[string]any) { d["palette"] = []string{"red"} },
		"no frames":          func(d map[string]any) { d["frames"] = []string{} },
		"wrong byte count":   func(d map[string]any) { d["frames"] = []string{frame(8, 1)} },
		"not base64":         func(d map[string]any) { d["frames"] = []string{"!!!"} },
		"index out of range": func(d map[string]any) { d["frames"] = []string{frame(16, 3)} },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Validate(docJSON(t, mutate))
			assert.Error(t, err)
		})
	}
}

func TestValidateRejectsOversizedAndMalformed(t *testing.T) {
	_, err := Validate(make([]byte, MaxDocBytes+1))
	assert.Error(t, err)
	_, err = Validate([]byte("{"))
	assert.Error(t, err)
	_, err = Validate(nil)
	assert.Error(t, err)
}

func TestValidateAcceptsLargestCanvas(t *testing.T) {
	_, err := Validate(docJSON(t, func(d map[string]any) {
		d["width"], d["height"] = 256, 256
		d["frames"] = []string{frame(256, 2)}
	}))
	assert.NoError(t, err)
}

func TestValidateAcceptsBanners(t *testing.T) {
	for _, size := range [][2]int{{100, 32}, {150, 48}} {
		_, err := Validate(docJSON(t, func(d map[string]any) {
			d["width"], d["height"] = size[0], size[1]
			d["frames"] = []string{base64.StdEncoding.EncodeToString(make([]byte, size[0]*size[1]))}
		}))
		assert.NoError(t, err, "%dx%d", size[0], size[1])
	}
	_, err := Validate(docJSON(t, func(d map[string]any) {
		d["width"], d["height"] = 100, 40
		d["frames"] = []string{base64.StdEncoding.EncodeToString(make([]byte, 4000))}
	}))
	assert.Error(t, err)
}
