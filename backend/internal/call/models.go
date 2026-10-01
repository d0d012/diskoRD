package call

// CallInviteEvent is sent to the callee when a call is initiated.
type CallInviteEvent struct {
	ChannelID  string `json:"channelId"`
	CallerID   string `json:"callerId"`
	CallerName string `json:"callerName"`
}

// CallAcceptEvent is sent to both participants when the call is accepted.
type CallAcceptEvent struct {
	ChannelID string `json:"channelId"`
	Token     string `json:"token"`
	URL       string `json:"url"`
}

// CallDeclineEvent is sent to the caller when the callee declines.
type CallDeclineEvent struct {
	ChannelID string `json:"channelId"`
}

// CallEndEvent is sent to both participants when someone ends the call.
type CallEndEvent struct {
	ChannelID string `json:"channelId"`
}

// CallTimeoutEvent is sent to both participants when a ring goes unanswered.
type CallTimeoutEvent struct {
	ChannelID string `json:"channelId"`
}
