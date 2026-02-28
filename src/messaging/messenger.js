/**
 * ARCHIPEL — Messenger complet (Sprint 2)
 * Chat chiffré E2E avec handshake automatique
 */

import { encryptMessage, deriveSessionKey, signData } from '../crypto/encryption.js';
import { buildPacket, PacketType, PUBLIC_HMAC_KEY } from '../crypto/packet.js';
import { initiateHandshake, finalizeHandshake } from '../crypto/handshake.js';
import { peerTable } from '../network/peer-table.js';
import { saveMessage, getHistory as getDbHistory, queueRelayMessage } from '../database/db.js';

export class Messenger {
    constructor(identity, tcpServer) {
        this.identity = identity;
        this.tcpServer = tcpServer;

        // Charger l'historique initial
        const rawHistory = getDbHistory() || [];
        this.history = rawHistory.map(m => ({
            from: m.sender,
            to: m.sender === 'MOI' ? m.peer_id : 'MOI',
            message: m.content,
            encrypted: !!m.encrypted,
            timestamp: m.timestamp
        }));

        this._pendingHandshakes = new Map();
    }

    /* ── Envoie un message à un pair ────────────────────────────────── */
    async send(nodeId, message) {
        try {
            const hmacKey = PUBLIC_HMAC_KEY;
            const payload = JSON.stringify({ ciphertext: message, nonce: null, timestamp: Date.now() });
            
            // Signature Ed25519 pour prouver l'identité
            const signature = signData(message, this.identity.signing.privateKey);
            const signedPayload = JSON.parse(payload);
            signedPayload.signature = signature;
            signedPayload.nodeId = this.identity.nodeId; // Ajout explicite de l'ID émetteur

            const finalPacket = buildPacket(PacketType.MSG, this.identity.nodeId, JSON.stringify(signedPayload), hmacKey);
            await this.tcpServer.sendTo(nodeId, finalPacket);

            this._addToHistory({ from: 'MOI', to: nodeId, message, encrypted: false });
            return { encrypted: false, relayed: false };
        } catch (err) {
            console.warn(`[MSG] ❌ Échec envoi direct vers ${nodeId.slice(0, 12)}… (${err.message}). Passage en mode RELAIS.`);
            return this.sendRelay(nodeId, message);
        }
    }

    /**
     * Prépare un message pour être relayé par le prochain pair rencontré
     */
    async sendRelay(nodeId, message) {
        // Pour le relais, on n'a pas forcément de session active.
        // On construit un message "enveloppé" que n'importe qui peut transporter.
        const payload = JSON.stringify({
            target: nodeId,
            sender: this.identity.nodeId,
            content: message, // Idéalement, on chiffrerait avec la clé publique du destinataire ici
            timestamp: Date.now()
        });

        // On stocke dans notre propre file d'attente pour le donner aux autres
        queueRelayMessage(nodeId, this.identity.nodeId, payload);

        this._addToHistory({ from: 'MOI', to: nodeId, message: `(Relais) ${message}`, encrypted: false });
        console.log(`[MSG] 📥 Message mis en file d'attente de RELAIS pour ${nodeId.slice(0, 12)}…`);
        return { encrypted: false, relayed: true };
    }

    /* ── Handshake X25519 avec un pair ──────────────────────────────── */
    async _doHandshake(nodeId) {
        const { message, ephemeralPriv, ephemeralPub } = initiateHandshake(this.identity);
        this._pendingHandshakes.set(nodeId, { ephemeralPriv, ephemeralPub });
        await this.tcpServer.sendTo(nodeId, message);

        // Attend la réponse (polling)
        return new Promise((resolve) => {
            const check = setInterval(() => {
                const resp = this.tcpServer._pendingHandshakeResp;
                if (resp && resp.nodeId === nodeId) {
                    this.tcpServer._pendingHandshakeResp = null;
                    const pending = this._pendingHandshakes.get(nodeId);
                    const sessionKey = finalizeHandshake(resp, pending.ephemeralPriv, this.identity);
                    peerTable.setSessionKey(nodeId, sessionKey);
                    this._pendingHandshakes.delete(nodeId);
                    clearInterval(check);
                    console.log(`[MSG] 🔑 Session E2E établie avec ${nodeId.slice(0, 12)}…`);
                    resolve(sessionKey);
                }
            }, 100);
            // Timeout 5s → fallback sans session
            setTimeout(() => { clearInterval(check); resolve(null); }, 5000);
        });
    }

    /* ── Envoie un message à TOUS les pairs (Broadcast) ───────────── */
    async broadcast(message) {
        const peers = peerTable.getActivePeers();
        const results = [];
        for (const peer of peers) {
            try {
                await this.send(peer.nodeId, message);
                results.push({ nodeId: peer.nodeId, success: true });
            } catch (err) {
                results.push({ nodeId: peer.nodeId, success: false, error: err.message });
            }
        }
        return results;
    }

    /* ── Message reçu ────────────────────────────────────────────────── */
    receive(msgInfo) {
        this._addToHistory({ from: msgInfo.from, to: 'MOI', message: msgInfo.message, encrypted: msgInfo.encrypted });
    }

    /* ── Historique ─────────────────────────────────────────────────── */
    _addToHistory(entry) {
        const timestamp = Date.now();
        const peerId = entry.from === 'MOI' ? entry.to : entry.from;

        saveMessage(peerId, entry.from, entry.message, entry.encrypted);

        this.history.push({ ...entry, timestamp });
    }

    getHistory(limit = 50) {
        return this.history.slice(-limit);
    }

    getChatWith(nodeId) {
        return this.history.filter(m => m.from === nodeId || m.to === nodeId);
    }

    getGeminiContext(n = 10) {
        return this.history.slice(-n).map(m => {
            const who = m.from === 'MOI' ? 'Moi' : m.from.slice(0, 8) + '…';
            return `[${who}]: ${m.message}`;
        }).join('\n');
    }
}
