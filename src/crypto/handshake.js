/**
 * ARCHIPEL — Handshake Archipel (inspiré Noise Protocol XX)
 * Établit une clé de session E2E avec Forward Secrecy
 *
 * Séquence :
 *   1. Alice → Bob : { ephemeral_dh_pub_Alice, nodeId_Alice, signingPub_Alice }
 *   2. Bob  → Alice : { ephemeral_dh_pub_Bob,  nodeId_Bob,   signingPub_Bob,  session_key_encrypted }
 *   3. Clé de session = HKDF(DH(ephAlice, ephBob) || DH(staticAlice, staticBob))
 */

import {
    generateKeyPairSync,
    createPrivateKey,
    createPublicKey,
    diffieHellman,
    createHash,
    createHmac,
    randomBytes,
} from 'crypto';
import { buildPacket, parsePacket, PacketType, PUBLIC_HMAC_KEY, parseJsonPayload } from './packet.js';

/**
 * Dérive une clé de session via double DH (Forward Secrecy)
 * @param {Buffer} dh1 - DH(éphémère_Alice, éphémère_Bob)
 * @param {Buffer} dh2 - DH(statique_Alice, statique_Bob)
 * @returns {string} Clé de session 32 bytes hex
 */
function deriveKey(dh1, dh2) {
    // HKDF simplifié : SHA256(dh1 || dh2)
    return createHash('sha256').update(Buffer.concat([dh1, dh2])).digest('hex');
}

/**
 * Calcule un DH X25519 entre deux clés en format DER hex
 */
function dh(privHex, pubHex) {
    const privateKey = createPrivateKey({ key: Buffer.from(privHex, 'hex'), format: 'der', type: 'pkcs8' });
    const publicKey = createPublicKey({ key: Buffer.from(pubHex, 'hex'), format: 'der', type: 'spki' });
    return diffieHellman({ privateKey, publicKey });
}

/**
 * INITIATEUR (Alice) — Étape 1 : génère un message de handshake
 * @param {Object} identity - Identité locale
 * @returns {{ message: Buffer, ephemeralPriv: string }} Message à envoyer + clé éphémère privée
 */
export function initiateHandshake(identity) {
    const ephemeral = generateKeyPairSync('x25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    const payload = JSON.stringify({
        type: 'HANDSHAKE_INIT',
        nodeId: identity.nodeId,
        signingPub: identity.signing.publicKey,
        dhPub: identity.dh.publicKey,
        ephemeralDhPub: ephemeral.publicKey.toString('hex'),
        timestamp: Date.now(),
    });

    const packet = buildPacket(PacketType.MSG, identity.nodeId, payload, PUBLIC_HMAC_KEY);

    return {
        message: packet,
        ephemeralPriv: ephemeral.privateKey.toString('hex'),
        ephemeralPub: ephemeral.publicKey.toString('hex'),
    };
}

/**
 * RÉPONDEUR (Bob) — Étape 2 : répond au handshake et calcule la clé de session
 * @param {Object} initData   - Données reçues du HANDSHAKE_INIT
 * @param {Object} identity   - Identité locale de Bob
 * @returns {{ responsePacket: Buffer, sessionKey: string }}
 */
export function respondHandshake(initData, identity) {
    const ephemeral = generateKeyPairSync('x25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    // DH1 : éphémère Bob × éphémère Alice
    const dh1 = dh(ephemeral.privateKey.toString('hex'), initData.ephemeralDhPub);
    // DH2 : statique Bob × statique Alice
    const dh2 = dh(identity.dh.privateKey, initData.dhPub);
    // Clé de session
    const sessionKey = deriveKey(dh1, dh2);

    const payload = JSON.stringify({
        type: 'HANDSHAKE_RESP',
        nodeId: identity.nodeId,
        signingPub: identity.signing.publicKey,
        dhPub: identity.dh.publicKey,
        ephemeralDhPub: ephemeral.publicKey.toString('hex'),
        timestamp: Date.now(),
    });

    const responsePacket = buildPacket(PacketType.MSG, identity.nodeId, payload, PUBLIC_HMAC_KEY);

    return { responsePacket, sessionKey };
}

/**
 * INITIATEUR (Alice) — Étape 3 : finalise la clé de session après réponse de Bob
 * @param {Object} respData       - Données reçues du HANDSHAKE_RESP
 * @param {string} ephemeralPriv  - Clé éphémère privée d'Alice
 * @param {Object} identity       - Identité locale d'Alice
 * @returns {string} sessionKey
 */
export function finalizeHandshake(respData, ephemeralPriv, identity) {
    // DH1 : éphémère Alice × éphémère Bob
    const dh1 = dh(ephemeralPriv, respData.ephemeralDhPub);
    // DH2 : statique Alice × statique Bob
    const dh2 = dh(identity.dh.privateKey, respData.dhPub);
    return deriveKey(dh1, dh2);
}
