/**
 * ARCHIPEL — Peer Table (Table des nœuds connus)
 * 
 * Maintient la liste des nœuds actifs sur le réseau local.
 * Un nœud est considéré mort après 90s sans HELLO reçu.
 */

const PEER_TIMEOUT_MS = 90_000; // 90 secondes
import { upsertPeer } from '../database/db.js';

class PeerTable {
    constructor() {
        /** @type {Map<string, PeerEntry>} nodeId -> PeerEntry */
        this.peers = new Map();
    }

    /**
     * Ajoute ou met à jour un nœud dans la table
     * @param {Object} peerInfo - Informations du nœud
     */
    upsert(peerInfo) {
        const { nodeId, ip, tcpPort, dhPublicKey, signingPublicKey, sharedFiles = [] } = peerInfo;

        const existing = this.peers.get(nodeId);
        this.peers.set(nodeId, {
            nodeId,
            ip,
            tcpPort,
            dhPublicKey,
            signingPublicKey,
            sharedFiles,
            lastSeen: Date.now(),
            reputation: existing ? existing.reputation : 100,
            sessionKey: existing ? existing.sessionKey : null,
        });

        // Sauvegarde persistante (pour Web of Trust)
        upsertPeer(nodeId, dhPublicKey, signingPublicKey);
    }

    /**
     * Supprime les nœuds morts (pas de HELLO depuis 90s)
     * @returns {string[]} IDs des nœuds supprimés
     */
    pruneDeadPeers() {
        const now = Date.now();
        const removed = [];
        for (const [nodeId, peer] of this.peers) {
            if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
                this.peers.delete(nodeId);
                removed.push(nodeId);
            }
        }
        return removed;
    }

    /**
     * Retourne la liste de tous les nœuds actifs
     */
    getActivePeers() {
        this.pruneDeadPeers();
        return Array.from(this.peers.values());
    }

    /**
     * Cherche un nœud par son ID
     */
    get(nodeId) {
        return this.peers.get(nodeId) || null;
    }

    /**
     * Enregistre une clé de session établie avec un nœud
     */
    setSessionKey(nodeId, sessionKey) {
        const peer = this.peers.get(nodeId);
        if (peer) {
            peer.sessionKey = sessionKey;
        }
    }

    /**
     * Diminue la réputation d'un nœud (chunk corrompu, etc.)
     */
    penalize(nodeId, amount = 10) {
        const peer = this.peers.get(nodeId);
        if (peer) {
            peer.reputation = Math.max(0, peer.reputation - amount);
        }
    }

    /**
     * Retourne un résumé de la table (pour PEER_LIST)
     */
    toSummary() {
        return this.getActivePeers().map(p => ({
            nodeId: p.nodeId,
            ip: p.ip,
            tcpPort: p.tcpPort,
            dhPublicKey: p.dhPublicKey,
            sharedFiles: p.sharedFiles,
            reputation: p.reputation,
        }));
    }

    /**
     * Affiche la table de façon lisible
     */
    display() {
        const peers = this.getActivePeers();
        if (peers.length === 0) {
            return '  (aucun pair découvert)';
        }
        return peers.map((p, i) => {
            const ago = Math.floor((Date.now() - p.lastSeen) / 1000);
            const shortId = p.nodeId.slice(0, 12) + '…';
            return `  [${i + 1}] ${shortId} | ${p.ip}:${p.tcpPort} | vu il y a ${ago}s | rep: ${p.reputation} | fichiers: ${p.sharedFiles.length}`;
        }).join('\n');
    }

    get size() {
        return this.peers.size;
    }
}

// Singleton global
export const peerTable = new PeerTable();
export default PeerTable;
