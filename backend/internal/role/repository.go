package role

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

func (r *Repository) ListByGuild(ctx context.Context, guildID string) ([]RoleResponse, error) {
	rows, err := r.db.Query(ctx,
		`SELECT gr.id, gr.name, gr.color, gr.position, gr.hoist,
		        COUNT(mr.user_id) AS member_count
		 FROM guild_roles gr
		 LEFT JOIN member_roles mr ON mr.role_id = gr.id
		 WHERE gr.guild_id = $1
		 GROUP BY gr.id
		 ORDER BY gr.position DESC`, guildID,
	)
	if err != nil {
		return nil, fmt.Errorf("role.Repository.ListByGuild: %w", err)
	}
	defer rows.Close()

	var roles []RoleResponse
	for rows.Next() {
		var ro RoleResponse
		if err := rows.Scan(&ro.ID, &ro.Name, &ro.Color, &ro.Position, &ro.Hoist, &ro.MemberCount); err != nil {
			return nil, fmt.Errorf("role.Repository.ListByGuild: scan: %w", err)
		}
		roles = append(roles, ro)
	}
	return roles, nil
}

func (r *Repository) Create(ctx context.Context, guildID, name, color string, hoist bool) (*Role, error) {
	// New roles get position = max(existing) + 1
	var maxPos int
	r.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(position), 0) FROM guild_roles WHERE guild_id = $1`, guildID,
	).Scan(&maxPos)

	var ro Role
	err := r.db.QueryRow(ctx,
		`INSERT INTO guild_roles (guild_id, name, color, position, hoist)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, guild_id, name, color, position, hoist, created_at`,
		guildID, name, color, maxPos+1, hoist,
	).Scan(&ro.ID, &ro.GuildID, &ro.Name, &ro.Color, &ro.Position, &ro.Hoist, &ro.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("role.Repository.Create: %w", err)
	}
	return &ro, nil
}

func (r *Repository) GetByID(ctx context.Context, roleID, guildID string) (*Role, error) {
	var ro Role
	err := r.db.QueryRow(ctx,
		`SELECT id, guild_id, name, color, position, hoist, created_at
		 FROM guild_roles WHERE id = $1 AND guild_id = $2`,
		roleID, guildID,
	).Scan(&ro.ID, &ro.GuildID, &ro.Name, &ro.Color, &ro.Position, &ro.Hoist, &ro.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fiber.NewError(fiber.StatusNotFound, "role not found")
	}
	if err != nil {
		return nil, fmt.Errorf("role.Repository.GetByID: %w", err)
	}
	return &ro, nil
}

func (r *Repository) Update(ctx context.Context, roleID, guildID string, req UpdateRoleRequest) (*Role, error) {
	ro, err := r.GetByID(ctx, roleID, guildID)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		ro.Name = *req.Name
	}
	if req.Color != nil {
		ro.Color = *req.Color
	}
	if req.Position != nil {
		ro.Position = *req.Position
	}
	if req.Hoist != nil {
		ro.Hoist = *req.Hoist
	}

	err = r.db.QueryRow(ctx,
		`UPDATE guild_roles SET name=$1, color=$2, position=$3, hoist=$4
		 WHERE id=$5 AND guild_id=$6
		 RETURNING id, guild_id, name, color, position, hoist, created_at`,
		ro.Name, ro.Color, ro.Position, ro.Hoist, roleID, guildID,
	).Scan(&ro.ID, &ro.GuildID, &ro.Name, &ro.Color, &ro.Position, &ro.Hoist, &ro.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("role.Repository.Update: %w", err)
	}
	return ro, nil
}

func (r *Repository) Delete(ctx context.Context, roleID, guildID string) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM guild_roles WHERE id = $1 AND guild_id = $2`, roleID, guildID,
	)
	if err != nil {
		return fmt.Errorf("role.Repository.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "role not found")
	}
	return nil
}

func (r *Repository) Reorder(ctx context.Context, guildID string, updates []ReorderItem) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("role.Repository.Reorder: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, u := range updates {
		_, err := tx.Exec(ctx,
			`UPDATE guild_roles SET position=$1 WHERE id=$2 AND guild_id=$3`,
			u.Position, u.ID, guildID,
		)
		if err != nil {
			return fmt.Errorf("role.Repository.Reorder: update %s: %w", u.ID, err)
		}
	}

	return tx.Commit(ctx)
}

func (r *Repository) AssignToMember(ctx context.Context, guildID, userID, roleID string) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO member_roles (guild_id, user_id, role_id)
		 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		guildID, userID, roleID,
	)
	if err != nil {
		return fmt.Errorf("role.Repository.AssignToMember: %w", err)
	}
	return nil
}

func (r *Repository) RemoveFromMember(ctx context.Context, guildID, userID, roleID string) error {
	_, err := r.db.Exec(ctx,
		`DELETE FROM member_roles WHERE guild_id=$1 AND user_id=$2 AND role_id=$3`,
		guildID, userID, roleID,
	)
	if err != nil {
		return fmt.Errorf("role.Repository.RemoveFromMember: %w", err)
	}
	return nil
}

func (r *Repository) GetMemberRoles(ctx context.Context, guildID, userID string) ([]RoleResponse, error) {
	rows, err := r.db.Query(ctx,
		`SELECT gr.id, gr.name, gr.color, gr.position, gr.hoist, 0
		 FROM guild_roles gr
		 JOIN member_roles mr ON mr.role_id = gr.id
		 WHERE mr.guild_id = $1 AND mr.user_id = $2
		 ORDER BY gr.position DESC`,
		guildID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("role.Repository.GetMemberRoles: %w", err)
	}
	defer rows.Close()

	var roles []RoleResponse
	for rows.Next() {
		var ro RoleResponse
		if err := rows.Scan(&ro.ID, &ro.Name, &ro.Color, &ro.Position, &ro.Hoist, &ro.MemberCount); err != nil {
			return nil, fmt.Errorf("role.Repository.GetMemberRoles: scan: %w", err)
		}
		roles = append(roles, ro)
	}
	return roles, nil
}

func (r *Repository) GetRoleMembersWithNames(ctx context.Context, roleID string) ([]struct {
	ID       string
	Username string
}, error) {
	rows, err := r.db.Query(ctx,
		`SELECT u.id, u.username
		 FROM users u
		 JOIN member_roles mr ON mr.user_id = u.id
		 WHERE mr.role_id = $1
		 ORDER BY u.username`, roleID,
	)
	if err != nil {
		return nil, fmt.Errorf("role.Repository.GetRoleMembersWithNames: %w", err)
	}
	defer rows.Close()

	var members []struct {
		ID       string
		Username string
	}
	for rows.Next() {
		var m struct {
			ID       string
			Username string
		}
		if err := rows.Scan(&m.ID, &m.Username); err != nil {
			return nil, fmt.Errorf("role.Repository.GetRoleMembersWithNames: scan: %w", err)
		}
		members = append(members, m)
	}
	return members, nil
}
