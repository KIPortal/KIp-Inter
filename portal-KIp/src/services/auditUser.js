'use strict';

/**
 * Usuario que firma un registro de Auditoría. El acceso de desarrollo crea
 * usuarios temporales (id "temporary:…") que no existen en la tabla User: si se
 * guardaran, la llave foránea AuditLog_userId_fkey rechazaría el registro.
 * En ese caso el registro queda sin usuario.
 */
function auditUserId(user) {
    const id = user && typeof user.id === 'string' ? user.id : null;
    return id && !id.startsWith('temporary:') ? id : null;
}

module.exports = { auditUserId };
