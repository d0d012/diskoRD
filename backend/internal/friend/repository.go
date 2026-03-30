package friend

import (
	"context"
	"errors"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// SendRequest creates a pending friendship row.
func (r *Repository) SendRequest(ctx context.Context, senderID, receiverID string) (*Friendship, error) {
	var f Friendship
	err := r.db.QueryRow(ctx,
		`INSERT INTO friendships (sender_id, receiver_id, status)
		 VALUES ($1, $2, 'pending')
		 RETURNING id, sender_id, receiver_id, status, created_at, updated_at`,
		senderID, receiverID,
	).Scan(&f.ID, &f.SenderID, &f.ReceiverID, &f.Status, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("friend.Repository.SendRequest: %w", err)
	}
	return &f, nil
}

// GetByID fetches a friendship by its ID.
func (r *Repository) GetByID(ctx context.Context, friendshipID string) (*Friendship, error) {
	var f Friendship
	err := r.db.QueryRow(ctx,
		`SELECT id, sender_id, receiver_id, status, created_at, updated_at
		 FROM friendships WHERE id = $1`, friendshipID,
	).Scan(&f.ID, &f.SenderID, &f.ReceiverID, &f.Status, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "friend request not found")
	}
	if err != nil {
		return nil, fmt.Errorf("friend.Repository.GetByID: %w", err)
	}
	return &f, nil
}

// GetBetween returns the friendship between two users if one exists.
func (r *Repository) GetBetween(ctx context.Context, userA, userB string) (*Friendship, error) {
	var f Friendship
	err := r.db.QueryRow(ctx,
		`SELECT id, sender_id, receiver_id, status, created_at, updated_at
		 FROM friendships
		 WHERE (sender_id = $1 AND receiver_id = $2)
		    OR (sender_id = $2 AND receiver_id = $1)`,
		userA, userB,
	).Scan(&f.ID, &f.SenderID, &f.ReceiverID, &f.Status, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("friend.Repository.GetBetween: %w", err)
	}
	return &f, nil
}

// UpdateStatus sets the friendship status.
func (r *Repository) UpdateStatus(ctx context.Context, friendshipID, status string) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE friendships SET status = $1, updated_at = now() WHERE id = $2`,
		status, friendshipID,
	)
	if err != nil {
		return fmt.Errorf("friend.Repository.UpdateStatus: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "friend request not found")
	}
	return nil
}

// Delete removes a friendship row.
func (r *Repository) Delete(ctx context.Context, friendshipID string) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM friendships WHERE id = $1`, friendshipID,
	)
	if err != nil {
		return fmt.Errorf("friend.Repository.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "friendship not found")
	}
	return nil
}

// ListFriends returns all accepted friends for a user with basic user info.
func (r *Repository) ListFriends(ctx context.Context, userID string) ([]FriendResponse, error) {
	rows, err := r.db.Query(ctx,
		`SELECT u.id, u.username, u.display_name, u.avatar_url
		 FROM friendships f
		 JOIN users u ON u.id = CASE
		   WHEN f.sender_id = $1 THEN f.receiver_id
		   ELSE f.sender_id
		 END
		 WHERE (f.sender_id = $1 OR f.receiver_id = $1)
		   AND f.status = 'accepted'
		 ORDER BY u.username`, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("friend.Repository.ListFriends: %w", err)
	}
	defer rows.Close()

	var friends []FriendResponse
	for rows.Next() {
		var f FriendResponse
		if err := rows.Scan(&f.ID, &f.Username, &f.DisplayName, &f.AvatarURL); err != nil {
			return nil, fmt.Errorf("friend.Repository.ListFriends scan: %w", err)
		}
		friends = append(friends, f)
	}
	return friends, nil
}

// ListRequests returns pending incoming and outgoing requests.
func (r *Repository) ListRequests(ctx context.Context, userID string) ([]FriendRequestResponse, error) {
	rows, err := r.db.Query(ctx,
		`SELECT f.id, f.sender_id, f.receiver_id, f.created_at,
		        u.id, u.username, u.display_name, u.avatar_url
		 FROM friendships f
		 JOIN users u ON u.id = CASE
		   WHEN f.sender_id = $1 THEN f.receiver_id
		   ELSE f.sender_id
		 END
		 WHERE (f.sender_id = $1 OR f.receiver_id = $1)
		   AND f.status = 'pending'
		 ORDER BY f.created_at DESC`, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("friend.Repository.ListRequests: %w", err)
	}
	defer rows.Close()

	var reqs []FriendRequestResponse
	for rows.Next() {
		var req FriendRequestResponse
		var senderID, receiverID string
		if err := rows.Scan(
			&req.ID, &senderID, &receiverID, &req.CreatedAt,
			&req.User.ID, &req.User.Username, &req.User.DisplayName, &req.User.AvatarURL,
		); err != nil {
			return nil, fmt.Errorf("friend.Repository.ListRequests scan: %w", err)
		}
		if senderID == userID {
			req.Direction = "outgoing"
		} else {
			req.Direction = "incoming"
		}
		reqs = append(reqs, req)
	}
	return reqs, nil
}

// GetOrCreateDM returns an existing DM channel or creates one. Always stores user_a < user_b.
func (r *Repository) GetOrCreateDM(ctx context.Context, userA, userB string) (*DMChannel, error) {
	// Enforce ordering
	a, b := userA, userB
	if a > b {
		a, b = b, a
	}

	var dm DMChannel
	err := r.db.QueryRow(ctx,
		`INSERT INTO dm_channels (user_a_id, user_b_id)
		 VALUES ($1, $2)
		 ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET user_a_id = EXCLUDED.user_a_id
		 RETURNING id, user_a_id, user_b_id, created_at`,
		a, b,
	).Scan(&dm.ID, &dm.UserAID, &dm.UserBID, &dm.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("friend.Repository.GetOrCreateDM: %w", err)
	}
	return &dm, nil
}

// ListDMs returns all DM channels for a user with the recipient's info.
func (r *Repository) ListDMs(ctx context.Context, userID string) ([]DMChannelResponse, error) {
	rows, err := r.db.Query(ctx,
		`SELECT d.id, d.created_at,
		        u.id, u.username, u.display_name, u.avatar_url
		 FROM dm_channels d
		 JOIN users u ON u.id = CASE
		   WHEN d.user_a_id = $1 THEN d.user_b_id
		   ELSE d.user_a_id
		 END
		 WHERE d.user_a_id = $1 OR d.user_b_id = $1
		 ORDER BY d.created_at DESC`, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("friend.Repository.ListDMs: %w", err)
	}
	defer rows.Close()

	var dms []DMChannelResponse
	for rows.Next() {
		var dm DMChannelResponse
		if err := rows.Scan(
			&dm.ID, &dm.CreatedAt,
			&dm.Recipient.ID, &dm.Recipient.Username,
			&dm.Recipient.DisplayName, &dm.Recipient.AvatarURL,
		); err != nil {
			return nil, fmt.Errorf("friend.Repository.ListDMs scan: %w", err)
		}
		dms = append(dms, dm)
	}
	return dms, nil
}

// GetDMByID fetches a DM channel, verifying the caller is a participant.
func (r *Repository) GetDMByID(ctx context.Context, dmID, userID string) (*DMChannel, error) {
	var dm DMChannel
	err := r.db.QueryRow(ctx,
		`SELECT id, user_a_id, user_b_id, created_at FROM dm_channels
		 WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)`,
		dmID, userID,
	).Scan(&dm.ID, &dm.UserAID, &dm.UserBID, &dm.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "DM channel not found")
	}
	if err != nil {
		return nil, fmt.Errorf("friend.Repository.GetDMByID: %w", err)
	}
	return &dm, nil
}
