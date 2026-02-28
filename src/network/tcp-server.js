/**
 * ARCHIPEL — Serveur TCP (Port 7777) — Version complète Sprint 2+3
 * Gère : MSG, PEER_LIST, ACK, HANDSHAKE, MANIFEST, CHUNK_REQ, CHUNK_DATA, HELLO, RELAY
 */

import net from 'net';
import {
    parsePacket, buildPacket, buildHelloPacket,
    PacketType, PacketTypeName,
    parseJsonPayload, PUBLIC_HMAC_KEY,
} from '../crypto/packet.js';
import { peerTable } from './peer-table.js';
import { decryptMessage, verifySignature } from '../crypto/encryption.js';
import { checkTrust } from '../crypto/wot.js';
import { respondHandshake } from '../crypto/handshake.js';
import { getLocalManifest } from '../transfer/file-index.js';
import { readChunk } from '../transfer/chunker.js';
import { fetchRelayMessages, queueRelayMessage } from '../database/db.js';

const TCP_PORT = 7777;
const KEEPALIVE_INTERVAL = 15_000;

export class TcpServer {
    constructor(identity, onMessageReceived, onPeerDiscovered) {
        this.identity = identity;
        this.onMessageReceived = onMessageReceived || (() => { });
        this.onPeerDiscovered = onPeerDiscovered || (() => { });
        this.onChunkReceived = () => { };
        this.server = null;
        this._port = TCP_PORT;
        /** @type {Map<string, net.Socket>} nodeId -> socket */
        this.connections = new Map();
    }

    /* ── Démarrage ─────────────────────────────────────────────────── */
    start(port = TCP_PORT) {
        return new Promise((resolve, reject) => {
            this.server = net.createServer(socket => this._handleConnection(socket));

            this.server.on('error', err => {
                if (err.code === 'EADDRINUSE') {
                    this.start(port + 1).then(resolve).catch(reject);
                } else {
                    reject(err);
                }
            });

            this.server.listen(port, '0.0.0.0', () => {
                this._port = port;
                console.log(`[TCP] ✅ Serveur TCP actif sur port ${port}`);
                resolve(port);
            });
        });
    }

    /* ── Connexion entrante ─────────────────────────────────────────── */
    _handleConnection(socket) {
        socket.setKeepAlive(true, KEEPALIVE_INTERVAL);
        let buffer = Buffer.alloc(0);

        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 41) {
                const payloadLen = buffer.readUInt32BE(37);
                const totalLen = 41 + payloadLen + 32;
                if (buffer.length < totalLen) break;

                const packetBuf = buffer.slice(0, totalLen);
                buffer = buffer.slice(totalLen);

                const hmacKey = this._getHmacKey(packetBuf);
                const packet = parsePacket(packetBuf, hmacKey);
                if (packet) this._handlePacket(packet, socket).catch(err => {
                    console.error('[TCP] ❌ Erreur handling packet:', err.message);
                });
            }
        });

        socket.on('error', err => {
            if (err.code !== 'ECONNRESET') console.warn('[TCP] ⚠️', err.message);
        });

        socket.on('close', () => {
            for (const [id, s] of this.connections) {
                if (s === socket) { this.connections.delete(id); break; }
            }
        });
    }

    /* ── Clé HMAC à utiliser selon l'émetteur ───────────────────────── */
    _getHmacKey(buf) {
        if (buf.length < 37) return PUBLIC_HMAC_KEY;
        const type = buf[4];
        const senderId = buf.slice(5, 37).toString('hex');
        const peer = peerTable.get(senderId);

        // Si on a une clé de session avec ce pair, on l'utilise en priorité
        if (peer?.sessionKey) return peer.sessionKey;

        // Sinon, fallback sur la clé publique (obligatoire pour HELLO)
        return PUBLIC_HMAC_KEY;
    }

    /* ── Dispatch des paquets reçus ────────────────────────────────── */
    async _handlePacket(packet, socket) {
        try {
            // On enregistre systématiquement la connexion pour ce nodeId
            if (packet.nodeId) {
                this.connections.set(packet.nodeId, socket);
            }

            const data = parseJsonPayload(packet);
            if (!data && packet.type !== PacketType.ACK) return;

            switch (packet.type) {

                /* ── HELLO (Découverte via TCP) ────────────────────────────── */
                case PacketType.HELLO: {
                    const peerInfo = {
                        nodeId: data.nodeId,
                        ip: socket.remoteAddress?.replace('::ffff:', ''),
                        tcpPort: data.tcpPort,
                        dhPublicKey: data.dhPublicKey,
                        signingPublicKey: data.signingPublicKey,
                        sharedFiles: data.sharedFiles || [],
                    };
                    const isNew = !peerTable.get(data.nodeId);
                    peerTable.upsert(peerInfo);
                    this.connections.set(data.nodeId, socket);
                    this.onPeerDiscovered(peerInfo);
                    console.log(`[TCP] ✨ Pair découvert via TCP: ${data.nodeId.slice(0, 12)}…`);

                    // Si c'est un nouveau pair qui nous contacte, on lui répond HELLO
                    // pour qu'il nous connaisse aussi immédiatement
                    if (isNew) {
                        import('../transfer/file-index.js').then(({ getSharedFileSummaries }) => {
                            const summaries = getSharedFileSummaries();
                            const hello = buildHelloPacket(this.identity, this._port, summaries);
                            socket.write(hello);
                        });
                    }
                    break;
                }

                /* ── MSG (chat + handshake) ────────────────────────────────── */
                case PacketType.MSG: {
                    // Handshake INIT
                    if (data.type === 'HANDSHAKE_INIT') {
                        const trust = checkTrust(data.nodeId, data.signingPub, data.dhPub);
                        if (!trust.trusted) {
                            console.warn(`[TCP] 🚨 Pair non fiable refusé: ${data.nodeId.slice(0, 12)}…`);
                            return;
                        }
                        const { responsePacket, sessionKey } = respondHandshake(data, this.identity);
                        peerTable.setSessionKey(data.nodeId, sessionKey);
                        socket.write(responsePacket);
                        this.connections.set(data.nodeId, socket);
                        console.log(`[TCP] 🤝 Handshake terminé avec ${data.nodeId.slice(0, 12)}…`);

                        // Vérifier s'il y a des messages en attente de relais pour ce pair
                        this._deliverRelayMessages(data.nodeId, socket);
                        return;
                    }

                    // Handshake RESP
                    if (data.type === 'HANDSHAKE_RESP') {
                        checkTrust(data.nodeId, data.signingPub, data.dhPub);
                        this.connections.set(data.nodeId, socket);
                        // La finalisation de la clé est faite côté Messenger
                        this._pendingHandshakeResp = data;

                        // Délivrer les messages en attente
                        this._deliverRelayMessages(data.nodeId, socket);
                        return;
                    }

                    // Message chat normal (Mode Simplifié Hackathon)
                    const peer = peerTable.get(packet.nodeId);
                    let text = data.ciphertext;
                    
                    // On tente de décrypter seulement si on a une session, sinon on prend le clair
                    if (peer?.sessionKey && data.nonce) {
                        const decrypted = decryptMessage(data.ciphertext, data.nonce, peer.sessionKey);
                        if (decrypted) text = decrypted;
                    }

                    this.connections.set(packet.nodeId, socket);
                    this.onMessageReceived({
                        from: packet.nodeId,
                        message: text,
                        timestamp: data.timestamp || Date.now(),
                        encrypted: !!peer?.sessionKey
                    });
                    break;
                }

                /* ── PEER_LIST ─────────────────────────────────────────────── */
                case PacketType.PEER_LIST: {
                    if (!data?.peers) return;
                    for (const p of data.peers) {
                        if (p.nodeId !== this.identity.nodeId) peerTable.upsert(p);
                    }
                    console.log(`[TCP] 📋 PEER_LIST: ${data.peers.length} pairs`);
                    break;
                }

                /* ── MANIFEST reçu ─────────────────────────────────────────── */
                case PacketType.MANIFEST: {
                    if (!data?.manifest) return;
                    const { saveRemoteManifest } = await import('../transfer/file-index.js');
                    saveRemoteManifest(data.manifest, packet.nodeId);
                    console.log(`[TCP] 📦 Manifest reçu: ${data.manifest.file_name}`);
                    this.onMessageReceived({
                        from: packet.nodeId,
                        message: `📦 Fichier disponnible: ${data.manifest.file_name} (${(data.manifest.file_size / 1024 / 1024).toFixed(2)} MB)`,
                        timestamp: Date.now(),
                        encrypted: false,
                    });
                    break;
                }

                /* ── CHUNK_REQ : un pair demande un chunk ──────────────────── */
                case PacketType.CHUNK_REQ: {
                    const manifest = getLocalManifest(data.file_id);
                    if (!manifest) return;

                    try {
                        const chunkData = readChunk(manifest.path, data.chunk_index);
                        const chunkInfo = manifest.chunks[data.chunk_index];
                        const payload = JSON.stringify({
                            type: 'CHUNK_DATA',
                            file_id: data.file_id,
                            chunk_index: data.chunk_index,
                            hash: chunkInfo.hash,
                            data: chunkData.toString('base64'),
                        });
                        const resp = buildPacket(PacketType.CHUNK_DATA, this.identity.nodeId, payload, PUBLIC_HMAC_KEY);
                        socket.write(resp);
                    } catch (err) {
                        console.error('[TCP] ❌ Erreur lecture chunk:', err.message);
                    }
                    break;
                }

                case PacketType.CHUNK_DATA: {
                    if (this._chunkHandlers && this._chunkHandlers[data.file_id]) {
                        this._chunkHandlers[data.file_id](data);
                    }
                    break;
                } /* ── RELAY reçu : on transporte ou on reçoit ? ────────────── */
                case PacketType.RELAY: {
                    if (!data || !data.target) return;

                    if (data.target === this.identity.nodeId) {
                        console.log(`[TCP] 📨 Message RELAY reçu de ${data.sender?.slice(0, 12) || 'Inconnu'}…`);
                        this.onMessageReceived({
                            from: data.sender || 'Inconnu',
                            message: `[Relay] ${data.content}`,
                            timestamp: data.timestamp || Date.now(),
                            encrypted: false
                        });
                    } else {
                        console.log(`[TCP] 🔄 On accepte de relayer un message pour ${data.target.slice(0, 12)}…`);
                        queueRelayMessage(data.target, data.sender, data);
                    }
                    break;
                }

                case PacketType.ACK:
                    break;

                default:
                    console.log(`[TCP] Paquet inconnu: ${PacketTypeName[packet.type] || packet.type}`);
            }
        } catch (err) {
            console.error('[TCP] 🚨 Crash évité dans _handlePacket:', err.message);
        }
    }

    /* ── Délivre les messages stockés pour un pair ─────────────────── */
    _deliverRelayMessages(nodeId, socket) {
        try {
            const messages = fetchRelayMessages(nodeId);
            if (messages.length > 0) {
                console.log(`[TCP] 📤 Délivrance de ${messages.length} message(s) en attente pour ${nodeId.slice(0, 12)}…`);
                for (const msg of messages) {
                    const packet = buildPacket(PacketType.RELAY, this.identity.nodeId, JSON.stringify(msg.packet_data), PUBLIC_HMAC_KEY);
                    socket.write(packet);
                }
            }
        } catch (err) {
            console.error('[TCP] ❌ Erreur délivrance relais:', err.message);
        }
    }

    /* ── Envoi TCP vers un pair ─────────────────────────────────────── */
    async sendTo(nodeId, packetBuf) {
        let socket = this.connections.get(nodeId);

        if (!socket || socket.destroyed) {
            const peer = peerTable.get(nodeId);
            if (!peer) {
                console.warn(`[TCP] ⚠️ Pair ${nodeId.slice(0, 12)}… inconnu dans peerTable. On attend le HELLO ?`);
                throw new Error(`Pair inconnu: ${nodeId}`);
            }
            socket = await this._connect(peer.ip, peer.tcpPort, nodeId);
        }

        return new Promise((resolve, reject) => {
            socket.write(packetBuf, err => err ? reject(err) : resolve());
        });
    }

    /* ── Nouvelle méthode : Force la connexion via IP (Découverte manuelle) ─── */
    async sendToIP(ip, port) {
        return new Promise((resolve, reject) => {
            console.log(`[TCP] 🔗 Connexion directe vers ${ip}:${port}...`);
            const socket = net.createConnection({ host: ip, port }, () => {
                socket.setKeepAlive(true, KEEPALIVE_INTERVAL);

                // Import local pour éviter les cycles
                import('../transfer/file-index.js').then(({ getSharedFileSummaries }) => {
                    const summaries = getSharedFileSummaries();
                    const hello = buildHelloPacket(this.identity, this._port, summaries);
                    socket.write(hello);
                    this._handleConnection(socket);
                    resolve(socket);
                });
            });
            socket.on('error', (err) => {
                console.error(`[TCP] ❌ Échec connexion vers ${ip}:${port}`);
                reject(err);
            });
            setTimeout(() => {
                if (!socket.connecting) return;
                socket.destroy();
                reject(new Error('Timeout connexion IP'));
            }, 10000);
        });
    }

    _connect(ip, port, nodeId) {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: ip, port }, () => {
                socket.setKeepAlive(true, KEEPALIVE_INTERVAL);
                this.connections.set(nodeId, socket);
                this._handleConnection(socket);
                this._deliverRelayMessages(nodeId, socket);
                resolve(socket);
            });
            socket.on('error', reject);
            setTimeout(() => {
                socket.destroy();
                reject(new Error('Timeout connexion TCP'));
            }, 5000);
        });
    }

    stop() {
        for (const s of this.connections.values()) s.destroy();
        this.connections.clear();
        if (this.server) this.server.close();
        console.log('[TCP] 🔴 Serveur arrêté');
    }

    get port() { return this._port; }
}
