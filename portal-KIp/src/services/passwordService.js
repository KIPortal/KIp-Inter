'use strict';

/**
 * Contraseñas con scrypt (incluido en Node, sin dependencias nuevas).
 * Formato guardado: scrypt$<N>$<salt base64>$<hash base64>
 *
 * Las contraseñas antiguas en texto plano se siguen aceptando una vez y se
 * convierten a hash en el siguiente inicio de sesión correcto (needsRehash).
 */

const crypto = require('crypto');

const PREFIX = 'scrypt';
const COST = 16384; // N
const KEY_LENGTH = 64;

function derive(plain, salt, cost) {
    return crypto.scryptSync(plain, salt, KEY_LENGTH, { N: cost, maxmem: 64 * 1024 * 1024 });
}

function hashPassword(plain) {
    const salt = crypto.randomBytes(16);
    const hash = derive(String(plain), salt, COST);
    return `${PREFIX}$${COST}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function isHashed(stored) {
    return typeof stored === 'string' && stored.startsWith(`${PREFIX}$`);
}

function safeEqual(a, b) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** @returns {{ ok: boolean, needsRehash: boolean }} */
function verifyPassword(plain, stored) {
    if (typeof plain !== 'string' || typeof stored !== 'string' || !stored) return { ok: false, needsRehash: false };
    if (!isHashed(stored)) {
        // Contraseña antigua en texto plano
        const ok = safeEqual(plain, stored);
        return { ok, needsRehash: ok };
    }
    const [, cost, salt, hash] = stored.split('$');
    const n = Number(cost);
    if (!Number.isInteger(n) || !salt || !hash) return { ok: false, needsRehash: false };
    try {
        const expected = Buffer.from(hash, 'base64');
        const actual = derive(plain, Buffer.from(salt, 'base64'), n);
        const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
        return { ok, needsRehash: ok && n !== COST };
    } catch {
        return { ok: false, needsRehash: false };
    }
}

module.exports = { hashPassword, verifyPassword, isHashed };
