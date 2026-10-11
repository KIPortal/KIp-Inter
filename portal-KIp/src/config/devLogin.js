'use strict';

/**
 * El acceso de desarrollo (entrar con cualquier correo como coordinador temporal,
 * sin usuario real en la base) queda APAGADO por defecto. Solo se activa si se
 * pide de forma explícita con ALLOW_DEV_LOGIN=true y nunca en producción.
 */
function isDevLoginEnabled() {
    return process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_LOGIN === 'true';
}

module.exports = { isDevLoginEnabled };
