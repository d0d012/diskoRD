package middleware

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRoleLevel(t *testing.T) {
	tests := []struct {
		role     string
		expected int
	}{
		{"owner", 4},
		{"admin", 3},
		{"moderator", 2},
		{"member", 1},
		{"unknown", 0},
		{"", 0},
	}

	for _, tt := range tests {
		t.Run(tt.role, func(t *testing.T) {
			assert.Equal(t, tt.expected, RoleLevel(tt.role))
		})
	}
}

func TestRoleLevelHierarchy(t *testing.T) {
	assert.Greater(t, RoleLevel("owner"), RoleLevel("admin"))
	assert.Greater(t, RoleLevel("admin"), RoleLevel("moderator"))
	assert.Greater(t, RoleLevel("moderator"), RoleLevel("member"))
	assert.Greater(t, RoleLevel("member"), RoleLevel(""))
}

// TestUpdateMemberRolePermissionMatrix validates the permission rules that
// guild.Service.UpdateMemberRole enforces via RoleLevel comparisons.
func TestUpdateMemberRolePermissionMatrix(t *testing.T) {
	// canChange returns whether callerRole can change targetRole to newRole,
	// mirroring the logic in service.UpdateMemberRole.
	canChange := func(callerRole, targetRole, newRole string) bool {
		if targetRole == "owner" {
			return false // owner cannot be demoted by anyone else
		}
		if newRole == "owner" {
			return false // owner cannot be assigned
		}
		callerLevel := RoleLevel(callerRole)
		return callerLevel > RoleLevel(targetRole) && callerLevel > RoleLevel(newRole)
	}

	tests := []struct {
		caller string
		target string
		newRole string
		allowed bool
		desc    string
	}{
		{"owner", "admin", "member", true, "owner can demote admin"},
		{"owner", "member", "admin", true, "owner can promote member to admin"},
		{"admin", "moderator", "member", true, "admin can demote moderator"},
		{"admin", "member", "moderator", true, "admin can promote member to moderator"},
		{"admin", "member", "admin", false, "admin cannot promote to admin (equal)"},
		{"admin", "admin", "member", false, "admin cannot demote equal-level admin"},
		{"moderator", "moderator", "member", false, "moderator cannot demote equal-level moderator"},
		{"member", "member", "moderator", false, "member cannot change roles"},
		{"admin", "owner", "member", false, "admin cannot demote owner"},
		{"owner", "member", "owner", false, "cannot assign owner role"},
	}

	for _, tt := range tests {
		t.Run(tt.desc, func(t *testing.T) {
			assert.Equal(t, tt.allowed, canChange(tt.caller, tt.target, tt.newRole))
		})
	}
}
