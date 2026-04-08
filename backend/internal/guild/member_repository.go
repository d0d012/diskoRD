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
		m.Roles = []RoleRef{}
		members = append(members, m)
	}
	rows.Close()

	if len(members) == 0 {
		return members, nil
	}

	// Batch-fetch all custom roles for members in this guild
	roleRows, err := r.db.Query(ctx,
		`SELECT mr.user_id, gr.id, gr.name, gr.color, gr.position, gr.hoist
		 FROM member_roles mr
		 JOIN guild_roles gr ON gr.id = mr.role_id
		 WHERE mr.guild_id = $1
		 ORDER BY gr.position DESC`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("guild.Repository.ListMembers: fetch roles: %w", err)
	}
	defer roleRows.Close()

	// Map userID → roles
	roleMap := make(map[string][]RoleRef)
	for roleRows.Next() {
		var userID string
		var ro RoleRef
		if err := roleRows.Scan(&userID, &ro.ID, &ro.Name, &ro.Color, &ro.Position, &ro.Hoist); err != nil {
			return nil, fmt.Errorf("guild.Repository.ListMembers: scan role: %w", err)
		}
		roleMap[userID] = append(roleMap[userID], ro)
	}

	for i, m := range members {
		if roles, ok := roleMap[m.ID]; ok {
			members[i].Roles = roles
		}
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
