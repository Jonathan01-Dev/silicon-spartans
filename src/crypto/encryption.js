/**
 * ARCHIPEL — Module Cryptographique : Chiffrement E2E
 * Utilise le module crypto NATIF de Node.js 22
 * X25519 ECDH pour la dérivation de clé de session
 * AES-256-GCM pour le chiffrement des messages (nonce 96-bit unique)
 */

import {
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    createHash,
    randomBytes,
    createCipheriv,
    createDecipheriv,
    sign,
    verify
} from 'crypto';

/**
 * Dérive une clé de session partagée via X25519 ECDH
 * @param {string} myPrivKeyHex  - Ma clé privée X25519 (DER PKCS8 en hex)
 * @param {string} theirPubKeyHex - La clé publique X25519 de l'autre nœud (DER SPKI en hex)
 * @returns {string} Clé de session (32 bytes hex)
 */
export function deriveSessionKey(myPrivKeyHex, theirPubKeyHex) {
    const privateKey = createPrivateKey({
        key: Buffer.from(myPrivKeyHex, 'hex'),
        format: 'der',
        type: 'pkcs8',
    });
    const publicKey = createPublicKey({
        key: Buffer.from(theirPubKeyHex, 'hex'),
        format: 'der',
        type: 'spki',
    });

    const sharedSecret = diffieHellman({ privateKey, publicKey });
    // Hash le secret partagé → clé AES-256 (32 bytes)
    return createHash('sha256').update(sharedSecret).digest('hex');
}

/**
 * Chiffre un message avec AES-256-GCM
 * Nonce 96-bit aléatoire unique par message — JAMAIS réutilisé
 * @param {string|Buffer} plaintext
 * @param {string} sessionKeyHex - 32 bytes hex
 * @returns {{ ciphertext: string, nonce: string }}
 */
export function encryptMessage(plaintext, sessionKeyHex) {
    const key = Buffer.from(sessionKeyHex, 'hex');
    const iv = randomBytes(12); // 96-bit nonce
    const msg = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf-8') : plaintext;

    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(msg), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16 bytes

    // On concatène ciphertext + authTag pour le stockage
    return {
        ciphertext: Buffer.concat([encrypted, authTag]).toString('hex'),
        nonce: iv.toString('hex'),
    };
}

/**
 * Déchiffre un message AES-256-GCM
 * @param {string} ciphertextHex - ciphertext + authTag (16 derniers bytes)
 * @param {string} nonceHex      - IV 96-bit
 * @param {string} sessionKeyHex - 32 bytes hex
 * @returns {string|null} Message déchiffré ou null si échec
 */
export function decryptMessage(ciphertextHex, nonceHex, sessionKeyHex) {
    try {
        const key = Buffer.from(sessionKeyHex, 'hex');
        const iv = Buffer.from(nonceHex, 'hex');
        const data = Buffer.from(ciphertextHex, 'hex');
        const authTag = data.slice(-16);
        const encrypted = data.slice(0, -16);

        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf-8');
    } catch {
        return null; // MITM ou corruption détectée
    }
}

/**
 * Signe une donnée avec une clé privée Ed25519
 */
export function signData(data, privateKeyHex) {
    const key = createPrivateKey({
        key: Buffer.from(privateKeyHex, 'hex'),
        format: 'der',
        type: 'pkcs8'
    });
    return sign(null, Buffer.from(data), key).toString('hex');
}

/**
 * Vérifie une signature Ed25519
 */
export function verifySignature(data, signatureHex, publicKeyHex) {
    try {
        const key = createPublicKey({
            key: Buffer.from(publicKeyHex, 'hex'),
            format: 'der',
            type: 'spki'
        });
        return verify(null, Buffer.from(data), key, Buffer.from(signatureHex, 'hex'));
    } catch {
        return false;
    }
}
