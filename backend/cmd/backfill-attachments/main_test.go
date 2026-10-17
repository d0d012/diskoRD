package main

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/d0d012/diskord/internal/storage"
)

type mockStore struct{ mock.Mock }

func (m *mockStore) SetAttachmentsIfEmpty(ctx context.Context, messageID string, urls []string) (bool, error) {
	args := m.Called(ctx, messageID, urls)
	return args.Bool(0), args.Error(1)
}

var images = []storage.MessageImage{
	{MessageID: "msg-1", URL: "/uploads/msg-1/image.png"},
	{MessageID: "msg-2", URL: "/uploads/msg-2/image.gif"},
}

func TestBackfillSetsEmptyAttachments(t *testing.T) {
	ctx := context.Background()
	store := &mockStore{}
	store.On("SetAttachmentsIfEmpty", ctx, "msg-1", []string{"/uploads/msg-1/image.png"}).Return(true, nil)
	// msg-2 already has attachments (or no longer exists): nothing changes.
	store.On("SetAttachmentsIfEmpty", ctx, "msg-2", []string{"/uploads/msg-2/image.gif"}).Return(false, nil)

	res, err := backfill(ctx, store, images, false)
	require.NoError(t, err)
	assert.Equal(t, result{Found: 2, Updated: 1}, res)
	store.AssertExpectations(t)
}

func TestBackfillDryRunWritesNothing(t *testing.T) {
	store := &mockStore{}

	res, err := backfill(context.Background(), store, images, true)
	require.NoError(t, err)
	assert.Equal(t, result{Found: 2}, res)
	store.AssertNotCalled(t, "SetAttachmentsIfEmpty", mock.Anything, mock.Anything, mock.Anything)
}

func TestBackfillStopsOnError(t *testing.T) {
	ctx := context.Background()
	store := &mockStore{}
	store.On("SetAttachmentsIfEmpty", ctx, "msg-1", mock.Anything).Return(false, errors.New("db down"))

	_, err := backfill(ctx, store, images, false)
	require.Error(t, err)
	store.AssertNotCalled(t, "SetAttachmentsIfEmpty", ctx, "msg-2", mock.Anything)
}
