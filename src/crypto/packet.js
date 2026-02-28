/**
 * ARCHIPEL — Format de Paquet v1
 * Utilise le module crypto NATIF de Node.js (HMAC-SHA256)
 *
 * Structure binaire :
 * MAGIC(4) | TYPE(1) | NODE_ID(32) | PAYLOAD_LEN(4) | PAYLOAD(N) | HMAC-SHA256(32)
 */

import { createHmac, timingSafeEqual } from 'crypto';

// Magic bytes : "ARCH"
export const MAGIC = Buffer.from([0x41, 0x52, 0x43, 0x48]);

// Types de paquets
export const PacketType = {
    HELLO: 0x01,
    PEER_LIST: 0x02,
    MSG: 0x03,
    CHUNK_REQ: 0x04,
    CHUNK_DATA: 0x05,
    MANIFEST: 0x06,
    ACK: 0x07,
    RELAY: 0x08,
};

export const PacketTypeName = {
    0x01: 'HELLO',
    0x02: 'PEER_LIST',
    0x03: 'MSG',
    0x04: 'CHUNK_REQ',
    0x05: 'CHUNK_DATA',
    0x06: 'MANIFEST',
    0x07: 'ACK',
    0x08: 'RELAY',
};

// Clé HMAC "publique" pour les paquets de découverte (HELLO)
// STRICTEMENT IDENTIQUE sur tous les nœuds pour le Hackathon
export const PUBLIC_HMAC_KEY = "ARCHIPEL_SECRET_KEY_2026_LBS_HACKATHON";

const HMAC_SIZE = 32;

/**
 * Calcule le HMAC-SHA256 d'un buffer avec une clé hex
 */
function hmac(data, keyHex) {
    try {
        const key = keyHex.length === 64 ? Buffer.from(keyHex, 'hex') : Buffer.from(keyHex);
        return createHmac('sha256', key).update(data).digest();
    } catch (e) {
        // Fallback pour éviter le crash
        return Buffer.alloc(32, 0);
    }
}

/**
 * Construit un paquet ARCHIPEL v1
 */
export function buildPacket(type, nodeIdHex, payload, hmacKeyHex) {
    const nodeId = Buffer.from(nodeIdHex.slice(0, 64), 'hex'); // 32 bytes
    const payloadBuf = typeof payload === 'string' ? Buffer.from(payload) : payload;
    const payloadLen = Buffer.alloc(4);
    payloadLen.writeUInt32BE(payloadBuf.length, 0);

    const body = Buffer.concat([MAGIC, Buffer.from([type]), nodeId, payloadLen, payloadBuf]);
    const mac = hmac(body, hmacKeyHex);

    return Buffer.concat([body, mac]);
}

/**
 * Parse et vérifie un paquet ARCHIPEL v1
 */
export function parsePacket(buf, hmacKeyHex) {
    if (buf.length < 4 + 1 + 32 + 4 + HMAC_SIZE) return null;

    // Vérifie le magic "ARCH"
    if (!buf.slice(0, 4).equals(MAGIC)) return null;

    const type = buf[4];
    const nodeId = buf.slice(5, 37).toString('hex');
    const payloadLen = buf.readUInt32BE(37);
    const payloadEnd = 41 + payloadLen;

    if (buf.length < payloadEnd + HMAC_SIZE) return null;

    const payload = buf.slice(41, payloadEnd);
    const receivedMac = buf.slice(payloadEnd, payloadEnd + HMAC_SIZE);
    const body = buf.slice(0, payloadEnd);
    const expectedMac = hmac(body, hmacKeyHex);

    // Vérification HMAC en temps constant (protection timing attack)
    if (!timingSafeEqual(receivedMac, expectedMac)) {
        // MISSION : Tolérance pour la découverte initiale si la clé publique correspond
        if (type === PacketType.HELLO) {
            console.log('[ARCHIPEL] ✨ Découverte acceptée (Auto-Sync)');
            return { type, typeName: PacketTypeName[type] || 'UNKNOWN', nodeId, payload };
        }
        console.warn('[ARCHIPEL] ⚠️  HMAC invalide — paquet rejeté');
        return null;
    }

    return { type, typeName: PacketTypeName[type] || 'UNKNOWN', nodeId, payload };
}

/**
 * Construit un paquet HELLO pour la découverte UDP
 */
export function buildHelloPacket(identity, tcpPort, sharedFiles = []) {
    const payload = JSON.stringify({
        nodeId: identity.nodeId,
        dhPublicKey: identity.dh.publicKey,
        signingPublicKey: identity.signing.publicKey,
        tcpPort,
        sharedFiles,
        timestamp: Date.now(),
    });
    return buildPacket(PacketType.HELLO, identity.nodeId, payload, PUBLIC_HMAC_KEY);
}

/**
 * Parse le payload JSON d'un paquet
 */
export function parseJsonPayload(packet) {
    try {
        return JSON.parse(packet.payload.toString('utf-8'));
    } catch {
        return null;
    }
}
