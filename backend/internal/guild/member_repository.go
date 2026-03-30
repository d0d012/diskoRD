package guild

import (
	"context"
	"fmt"

	"github.com/gofiber/fiber/v2"
)

func (r *Repository) ListMembers(ctx context.Context, guildID string) ([]MemberResponse, error) {
	rows, err := r.db.Query(ctx,
		`SELECT u.id, u.username, u.display_name, u.avatar_url, gm.role, gm.joined_at
		 FROM guild_members gm
		 JOIN users u ON u.id = gm.user_id
		 WHERE gm.guild_id = $1
		 ORDER BY gm.joined_at ASC`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("guild.Repository.ListMembers: %w", err)
	}
	defer rows.Close()

	var members []MemberResponse
	for rows.Next() {
		var m MemberResponse
		if err := rows.Scan(&m.ID, &m.Username, &m.DisplayName, &m.AvatarURL, &m.Role, &m.JoinedAt); err != nil {
			return nil, fmt.Errorf("guild.Repository.ListMembers: scan: %w", err)
		}
		members = append(members, m)
	}
	return members, nil
}

func (r *Repository) RemoveMember(ctx context.Context, guildID, userID string) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
		guildID, userID,
	)
	if err != nil {
		return fmt.Errorf("guild.Repository.RemoveMember: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "member not found")
	}
	return nil
}
