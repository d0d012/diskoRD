package message

import (
	"context"
	"errors"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type replyRepoMock struct {
	MessageRepository
	channel      *ChannelContext
	parent       *MessageResponse
	preview      *ReferencedMessage
	created      bool
	createdReply *string
	list         []MessageResponse
	mentionScope string
}

func (m *replyRepoMock) GetChannelContext(_ context.Context, _ string) (*ChannelContext, error) {
	return m.channel, nil
}
func (m *replyRepoMock) GetByID(_ context.Context, _ string) (*MessageResponse, error) {
	if m.parent == nil {
		return nil, fiber.NewError(404, "message not found")
	}
	return m.parent, nil
}
func (m *replyRepoMock) GetReferences(_ context.Context, _ []string) (map[string]*ReferencedMessage, error) {
	return map[string]*ReferencedMessage{"parent": m.preview}, nil
}
func (m *replyRepoMock) List(_ context.Context, _ string, _ *string, _ int) ([]MessageResponse, error) {
	return m.list, nil
}
func (m *replyRepoMock) GetReactionsForMessages(_ context.Context, _ []string, _ string) (map[string][]ReactionRef, error) {
	return nil, nil
}
func (m *replyRepoMock) GetUserIDsByUsernames(_ context.Context, channelID string, _ []string) (map[string]string, error) {
	m.mentionScope = channelID
	return map[string]string{"alice": "alice-id"}, nil
}
func (m *replyRepoMock) Create(_ context.Context, channel, author, content string, reply *string) (*MessageResponse, error) {
	m.created = true
	m.createdReply = reply
	return &MessageResponse{ID: "new", ChannelID: channel, Content: content, Author: AuthorInfo{ID: author}}, nil
}

type replyPublisher struct{ created *MessageResponse }

func (p *replyPublisher) PublishToGuild(_ string, op string, data interface{}) {
	if op == "MESSAGE_CREATE" {
		p.created = data.(*MessageResponse)
	}
}
func (p *replyPublisher) PublishToDM(_, _ string, op string, data interface{}) {
	if op == "MESSAGE_CREATE" {
		p.created = data.(*MessageResponse)
	}
}

type replyGuildMock struct {
	GuildMembership
	member bool
}

func (m replyGuildMock) IsMember(context.Context, string, string) (bool, error) { return m.member, nil }

func TestSendReplyValidation(t *testing.T) {
	id := "parent"
	for _, tc := range []struct {
		name       string
		channel    *ChannelContext
		member     bool
		parent     *MessageResponse
		wantCode   int
		wantCreate bool
	}{
		{"guild reply", &ChannelContext{GuildID: "guild"}, true, &MessageResponse{ID: id, ChannelID: "ch"}, 0, true},
		{"DM reply", &ChannelContext{IsDM: true, DMUserA: "me", DMUserB: "you"}, false, &MessageResponse{ID: id, ChannelID: "ch"}, 0, true},
		{"cross-channel", &ChannelContext{GuildID: "guild"}, true, &MessageResponse{ID: id, ChannelID: "other"}, 400, false},
		{"missing or deleted", &ChannelContext{GuildID: "guild"}, true, nil, 400, false},
		{"not a member", &ChannelContext{GuildID: "guild"}, false, &MessageResponse{ID: id, ChannelID: "ch"}, 403, false},
		{"not DM participant", &ChannelContext{IsDM: true, DMUserA: "a", DMUserB: "b"}, false, &MessageResponse{ID: id, ChannelID: "ch"}, 403, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &replyRepoMock{channel: tc.channel, parent: tc.parent, preview: &ReferencedMessage{ID: id, AuthorName: "User", Content: "hi"}}
			svc := NewService(repo, replyGuildMock{member: tc.member})
			pub := &replyPublisher{}
			svc.SetPublisher(pub)
			msg, err := svc.Send(context.Background(), "me", "ch", CreateMessageRequest{Content: "hello @Alice @outsider", ReplyTo: &id})
			assert.Equal(t, tc.wantCreate, repo.created)
			if tc.wantCode != 0 {
				var fe *fiber.Error
				require.ErrorAs(t, err, &fe)
				assert.Equal(t, tc.wantCode, fe.Code)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, &id, repo.createdReply)
			assert.Equal(t, id, msg.ReferencedMessage.ID)
			assert.Equal(t, &id, msg.ReplyTo)
			assert.Equal(t, "ch", repo.mentionScope)
			assert.Equal(t, []string{"alice-id"}, msg.Mentions)
			assert.Equal(t, []string{"Alice"}, msg.MentionUsernames)
			require.NotNil(t, pub.created)
			assert.Equal(t, id, pub.created.ReferencedMessage.ID)
			assert.Equal(t, msg.Mentions, pub.created.Mentions)
		})
	}
}

func TestListIncludesReplyPreview(t *testing.T) {
	id := "parent"
	repo := &replyRepoMock{channel: &ChannelContext{IsDM: true, DMUserA: "me", DMUserB: "you"}, preview: &ReferencedMessage{ID: id, Deleted: true}, list: []MessageResponse{{ID: "child", ChannelID: "ch", Content: "@Alice", ReplyTo: &id}}}
	page, err := NewService(repo, replyGuildMock{}).List(context.Background(), "me", "ch", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	assert.True(t, page.Items[0].ReferencedMessage.Deleted)
	assert.Equal(t, "ch", repo.mentionScope)
	assert.Equal(t, []string{"alice-id"}, page.Items[0].Mentions)
	assert.Equal(t, []string{"Alice"}, page.Items[0].MentionUsernames)
}

func TestSendReplyCreateErrorDoesNotLeak(t *testing.T) {
	// A stale parent rejected by the atomic INSERT is a safe client error; other DB errors are hidden.
	assert.Equal(t, 500, sendError(errors.New("db unavailable")).(*fiber.Error).Code)
	assert.Equal(t, 400, sendError(fiber.NewError(400, "invalid reply")).(*fiber.Error).Code)
}
