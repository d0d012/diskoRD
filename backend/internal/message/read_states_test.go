package message

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type readRepoMock struct{ mockMessageRepo }

func (r *readRepoMock) IncrementMentions(ctx context.Context, channel string, users []string, dm bool, at time.Time) error {
	return r.Called(ctx, channel, users, dm, at).Error(0)
}
func (r *readRepoMock) Ack(ctx context.Context, user, channel string, dm bool) (time.Time, error) {
	args := r.Called(ctx, user, channel, dm)
	return args.Get(0).(time.Time), args.Error(1)
}

type readPublisherMock struct {
	mentionPublisher
	mock.Mock
}

func (p *readPublisherMock) NotifyReadState(user, exclude string, data interface{}) {
	p.Called(user, exclude, data)
}

func TestReadStateMentions(t *testing.T) {
	for _, dm := range []bool{false, true} {
		t.Run(map[bool]string{false: "guild", true: "DM"}[dm], func(t *testing.T) {
			repo := &readRepoMock{}
			members := &mockGuildMembership{}
			cc := &ChannelContext{GuildID: "g", ChannelType: "text", IsDM: dm, DMUserA: "author", DMUserB: "recipient"}
			repo.On("GetChannelContext", mock.Anything, "ch").Return(cc, nil)
			if !dm {
				members.On("IsMember", mock.Anything, "g", "author").Return(true, nil)
			}
			content := "hi @me @alice @ALICE @outsider"
			repo.On("GetUserIDsByUsernames", mock.Anything, "ch", mock.Anything).Return(map[string]string{"me": "author", "alice": "recipient"}, nil)
			repo.On("Create", mock.Anything, "ch", "author", content, (*string)(nil)).Return(&MessageResponse{ChannelID: "ch", Author: AuthorInfo{ID: "author"}, Content: content}, nil)
			repo.On("IncrementMentions", mock.Anything, "ch", []string{"recipient"}, dm, mock.Anything).Return(nil).Once()
			_, err := NewService(repo, members).Send(context.Background(), "author", "ch", CreateMessageRequest{Content: content})
			require.NoError(t, err)
			repo.AssertExpectations(t)
		})
	}
}

func TestDMEveryMessageCountsWithoutExplicitMention(t *testing.T) {
	repo := &readRepoMock{}
	repo.On("IncrementMentions", mock.Anything, "ch", []string{"other"}, true, mock.Anything).Return(nil).Once()
	NewService(repo, nil).recordMentions(context.Background(), &MessageResponse{ChannelID: "ch", Author: AuthorInfo{ID: "me"}}, &ChannelContext{IsDM: true, DMUserA: "other", DMUserB: "me"})
	repo.AssertExpectations(t)
}

func TestAckChecksAccessResetsAndNotifiesOtherConnections(t *testing.T) {
	for _, dm := range []bool{false, true} {
		repo := &readRepoMock{}
		members := &mockGuildMembership{}
		pub := &readPublisherMock{}
		cc := &ChannelContext{IsDM: dm, DMUserA: "me", DMUserB: "other", GuildID: "g", ChannelType: "text"}
		repo.On("GetChannelContext", mock.Anything, "ch").Return(cc, nil)
		if !dm {
			members.On("IsMember", mock.Anything, "g", "me").Return(true, nil)
		}
		now := time.Now()
		repo.On("Ack", mock.Anything, "me", "ch", dm).Return(now, nil).Once()
		pub.On("NotifyReadState", "me", "origin", &ReadStateUpdate{ChannelID: "ch", LastReadAt: now, MentionCount: 0}).Once()
		svc := NewService(repo, members)
		svc.SetPublisher(pub)
		result, err := svc.Ack(context.Background(), "me", "ch", "origin")
		require.NoError(t, err)
		assert.Equal(t, now, result.LastReadAt)
		repo.AssertExpectations(t)
		pub.AssertExpectations(t)
	}
}

func TestAckRejectsOutsiders(t *testing.T) {
	repo := &readRepoMock{}
	repo.On("GetChannelContext", mock.Anything, "ch").Return(&ChannelContext{IsDM: true, DMUserA: "a", DMUserB: "b"}, nil)
	_, err := NewService(repo, nil).Ack(context.Background(), "outsider", "ch", "")
	require.Error(t, err)
	repo.AssertNotCalled(t, "Ack", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}
