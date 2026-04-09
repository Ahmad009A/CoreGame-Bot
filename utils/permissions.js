/**
 * Check if a member has admin or staff role
 */
function isAdmin(member) {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (!adminRoleId) return member.permissions.has('Administrator');
  return member.roles.cache.has(adminRoleId) || member.permissions.has('Administrator');
}

function isStaff(member) {
  const staffRoleId = process.env.STAFF_ROLE_ID;
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  return (
    (staffRoleId && member.roles.cache.has(staffRoleId)) ||
    (adminRoleId && member.roles.cache.has(adminRoleId)) ||
    member.permissions.has('Administrator')
  );
}

module.exports = { isAdmin, isStaff };
