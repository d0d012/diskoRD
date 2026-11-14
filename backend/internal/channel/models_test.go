package channel

import (
	"testing"

	"github.com/go-playground/validator/v10"
	"github.com/stretchr/testify/assert"
)

func TestCreateChannelRequestType(t *testing.T) {
	v := validator.New()
	for _, tc := range []struct {
		typ   string
		valid bool
	}{
		{"text", true},
		{"voice", true},
		{"whiteboard", true},
		{"", false},
		{"board", false},
		{"Whiteboard", false},
	} {
		t.Run(tc.typ, func(t *testing.T) {
			err := v.Struct(CreateChannelRequest{Name: "n", Type: tc.typ})
			assert.Equal(t, tc.valid, err == nil)
		})
	}
}
