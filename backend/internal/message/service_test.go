package message

import (
	"context"
	"errors"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// Unused repository operations deliberately panic if the service calls them.
type mockMessageRepo struct {
	MessageRepository
	mock.Mock
}

func (m *mockMessageRepo) GetChannelContext(ctx context.Context, id string) (*ChannelContext, error) {
	a := m.Called(ctx, id)
	return a.Get(0).(*ChannelContext), a.Error(1)
}
func (m *mockMessageRepo) GetUserIDsByUsernames(ctx context.Context, channelID string, names []string) (map[string]string, error) {
	a := m.Called(ctx, channelID, names)
	return a.Get(0).(map[string]string), a.Error(1)
}
func (m *mockMessageRepo) Create(ctx context.Context, channelID, authorID, content string, replyTo *string) (*MessageResponse, error) {
	a := m.Called(ctx, channelID, authorID, content, replyTo)
	return a.Get(0).(*MessageResponse), a.Error(1)
}
func (m *mockMessageRepo) List(ctx context.Context, channelID string, before *string, limit int) ([]MessageResponse, error) {
	a := m.Called(ctx, channelID, before, limit)
	return a.Get(0).([]MessageResponse), a.Error(1)
}
func (m *mockMessageRepo) GetAuthorChannelAndGuild(ctx context.Context, id string) (string, string, string, error) {
	a := m.Called(ctx, id)
	return a.String(0), a.String(1), a.String(2), a.Error(3)
}
func (m *mockMessageRepo) Update(ctx context.Context, id, content string) (*MessageResponse, error) {
	a := m.Called(ctx, id, content)
	return a.Get(0).(*MessageResponse), a.Error(1)
}
func (m *mockMessageRepo) GetReferences(ctx context.Context, ids []string) (map[string]*ReferencedMessage, error) {
	a := m.Called(ctx, ids)
	return a.Get(0).(map[string]*ReferencedMessage), a.Error(1)
}
func (m *mockMessageRepo) GetReactionsForMessages(ctx context.Context, ids []string, viewer string) (map[string][]ReactionRef, error) {
	a := m.Called(ctx, ids, viewer)
	return a.Get(0).(map[string][]ReactionRef), a.Error(1)
}

type mockGuildMembership struct {
	GuildMembership
	mock.Mock
}

func (m *mockGuildMembership) IsMember(ctx context.Context, guildID, userID string) (bool, error) {
	a := m.Called(ctx, guildID, userID)
	return a.Bool(0), a.Error(1)
}

type mentionPublisher struct{ messages []*MessageResponse }

func (p *mentionPublisher) PublishToGuild(_, _ string, data interface{}) {
	p.messages = append(p.messages, data.(*MessageResponse))
}
func (p *mentionPublisher) PublishToDM(_, _, _ string, data interface{}) {
	p.messages = append(p.messages, data.(*MessageResponse))
}

func TestParseMentionUsernames(t *testing.T) {
	assert.Equal(t, []string{"alice", "bob_2", "Alice"}, parseMentionUsernames("@alice @bob_2 @alice @Alice"))
	assert.Empty(t, parseMentionUsernames("no mentions @"))
}

func TestSendResolvesMentionsInChannelScope(t *testing.T) {
	for _, tc := range []struct {
		name, channel string
		cc            *ChannelContext
	}{
		{"guild members only", "guild-channel", &ChannelContext{GuildID: "guild"}},
		{"DM participants only", "dm-channel", &ChannelContext{IsDM: true, DMUserA: "sender", DMUserB: "alice-id"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockMessageRepo{}
			members := &mockGuildMembership{}
			svc := NewService(repo, members)
			pub := &mentionPublisher{}
			svc.SetPublisher(pub)
			content := "hi @alice @outsider @alice"
			repo.On("GetChannelContext", mock.Anything, tc.channel).Return(tc.cc, nil).Once()
			if !tc.cc.IsDM {
				members.On("IsMember", mock.Anything, "guild", "sender").Return(true, nil).Once()
			}
			repo.On("Create", mock.Anything, tc.channel, "sender", content, (*string)(nil)).Return(&MessageResponse{ID: "msg", ChannelID: tc.channel, Content: content}, nil).Once()
			// The persistence boundary must receive the channel, not a global lookup.
			repo.On("GetUserIDsByUsernames", mock.Anything, tc.channel, []string{"alice", "outsider"}).Return(map[string]string{"alice": "alice-id"}, nil).Once()

			msg, err := svc.Send(context.Background(), "sender", tc.channel, CreateMessageRequest{Content: content})
			require.NoError(t, err)
			assert.Equal(t, []string{"alice-id"}, msg.Mentions)
			assert.Equal(t, []string{"alice"}, msg.MentionUsernames)
			require.Len(t, pub.messages, 1)
			assert.Equal(t, msg.Mentions, pub.messages[0].Mentions)
			repo.AssertExpectations(t)
			members.AssertExpectations(t)
		})
	}
}

func TestMentionResolutionFailsClosedAndClearsStaleMentions(t *testing.T) {
	for _, tc := range []struct {
		name, content string
		lookup        bool
		lookupErr     error
	}{
		{"no mentions", "hello", false, nil},
		{"nonmember", "@outsider", true, nil},
		{"lookup error", "@outsider", true, errors.New("database unavailable")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockMessageRepo{}
			if tc.lookup {
				repo.On("GetUserIDsByUsernames", mock.Anything, "channel", []string{"outsider"}).Return(map[string]string{}, tc.lookupErr).Once()
			}
			msg := &MessageResponse{ChannelID: "channel", Content: tc.content, Mentions: []string{"stale-id"}, MentionUsernames: []string{"outsider"}}
			NewService(repo, nil).resolveMentions(context.Background(), msg)
			assert.Equal(t, []string{}, msg.Mentions)
			assert.Equal(t, []string{}, msg.MentionUsernames)
			repo.AssertExpectations(t)
		})
	}
}

func TestListBatchesScopedMentionsForHistory(t *testing.T) {
	repo := &mockMessageRepo{}
	repo.On("GetChannelContext", mock.Anything, "dm").Return(&ChannelContext{IsDM: true, DMUserA: "viewer", DMUserB: "alice-id"}, nil)
	repo.On("List", mock.Anything, "dm", (*string)(nil), 50).Return([]MessageResponse{
		{ID: "newer", ChannelID: "dm", Content: "@outsider @alice"},
		{ID: "older", ChannelID: "dm", Content: "@alice"},
	}, nil)
	repo.On("GetUserIDsByUsernames", mock.Anything, "dm", []string{"outsider", "alice"}).Return(map[string]string{"alice": "alice-id"}, nil).Once()
	repo.On("GetReferences", mock.Anything, []string(nil)).Return(map[string]*ReferencedMessage{}, nil).Once()
	repo.On("GetReactionsForMessages", mock.Anything, []string{"older", "newer"}, "viewer").Return(map[string][]ReactionRef{}, nil)
	page, err := NewService(repo, nil).List(context.Background(), "viewer", "dm", nil, 50)
	require.NoError(t, err)
	require.Len(t, page.Items, 2)
	for _, msg := range page.Items {
		assert.Equal(t, []string{"alice-id"}, msg.Mentions)
		assert.Equal(t, []string{"alice"}, msg.MentionUsernames)
	}
	repo.AssertExpectations(t)
}

func TestEditRecomputesScopedMentionsAndKeepsReply(t *testing.T) {
	parentID := "parent"
	preview := &ReferencedMessage{ID: parentID, AuthorName: "Alice", Content: "original"}
	for _, content := range []string{"@Alice @outsider", "removed all mentions"} {
		t.Run(content, func(t *testing.T) {
			repo := &mockMessageRepo{}
			repo.On("GetAuthorChannelAndGuild", mock.Anything, "msg").Return("author", "channel", "guild", nil)
			repo.On("GetChannelContext", mock.Anything, "channel").Return(&ChannelContext{GuildID: "guild"}, nil)
			repo.On("Update", mock.Anything, "msg", content).Return(&MessageResponse{ID: "msg", ChannelID: "channel", Content: content, ReplyTo: &parentID}, nil)
			repo.On("GetReferences", mock.Anything, []string{parentID}).Return(map[string]*ReferencedMessage{parentID: preview}, nil).Once()
			repo.On("GetReactionsForMessages", mock.Anything, []string{"msg"}, "author").Return(map[string][]ReactionRef{}, nil)
			if content[0] == '@' {
				repo.On("GetUserIDsByUsernames", mock.Anything, "channel", []string{"Alice", "outsider"}).Return(map[string]string{"alice": "alice-id"}, nil).Once()
			}
			svc := NewService(repo, nil)
			pub := &mentionPublisher{}
			svc.SetPublisher(pub)
			msg, err := svc.Edit(context.Background(), "author", "msg", EditMessageRequest{Content: content})
			require.NoError(t, err)
			if content[0] == '@' {
				assert.Equal(t, []string{"alice-id"}, msg.Mentions)
				assert.Equal(t, []string{"Alice"}, msg.MentionUsernames)
			} else {
				assert.Equal(t, []string{}, msg.Mentions)
				assert.Equal(t, []string{}, msg.MentionUsernames)
			}
			assert.Equal(t, &parentID, msg.ReplyTo)
			assert.Equal(t, preview, msg.ReferencedMessage)
			require.Len(t, pub.messages, 1)
			assert.Equal(t, preview, pub.messages[0].ReferencedMessage)
			assert.Equal(t, msg.Mentions, pub.messages[0].Mentions)
			repo.AssertExpectations(t)
		})
	}
}

func TestNonparticipantCannotSendDM(t *testing.T) {
	repo := &mockMessageRepo{}
	repo.On("GetChannelContext", mock.Anything, "dm").Return(&ChannelContext{IsDM: true, DMUserA: "alice", DMUserB: "bob"}, nil)
	_, err := NewService(repo, nil).Send(context.Background(), "outsider", "dm", CreateMessageRequest{Content: "@alice"})
	var httpErr *fiber.Error
	require.ErrorAs(t, err, &httpErr)
	assert.Equal(t, fiber.StatusForbidden, httpErr.Code)
	repo.AssertExpectations(t)
}
