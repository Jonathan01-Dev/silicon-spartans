/**
 * ARCHIPEL — Serveur TCP (Port 7777) — Version complète Sprint 2+3
 * Gère : MSG, PEER_LIST, ACK, HANDSHAKE, MANIFEST, CHUNK_REQ, CHUNK_DATA
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
                if (packet) this._handlePacket(packet, socket);
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
        const senderId = buf.slice(5, 37).toString('hex');
        const peer = peerTable.get(senderId);
        return peer?.sessionKey || PUBLIC_HMAC_KEY;
    }

    /* ── Dispatch des paquets reçus ─────────────────────────────────── */
    async _handlePacket(packet, socket) {
        const data = parseJsonPayload(packet);

        switch (packet.type) {

            /* ── HELLO (Découverte via TCP) ────────────────────────────── */
            case PacketType.HELLO: {
                if (!data) return;
                const peerInfo = {
                    nodeId: data.nodeId,
                    ip: socket.remoteAddress?.replace('::ffff:', ''),
                    tcpPort: data.tcpPort,
                    dhPublicKey: data.dhPublicKey,
                    signingPublicKey: data.signingPublicKey,
                    sharedFiles: data.sharedFiles || [],
                };
                peerTable.upsert(peerInfo);
                this.connections.set(data.nodeId, socket);
                this.onPeerDiscovered(peerInfo);
                console.log(`[TCP] ✨ Pair découvert via TCP: ${data.nodeId.slice(0, 12)}…`);
                break;
            }

            /* ── MSG (chat + handshake) ────────────────────────────────── */
            case PacketType.MSG: {
                if (!data) return;

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

                // Message chat normal
                const peer = peerTable.get(packet.nodeId);
                let text = data.ciphertext;
                if (peer?.sessionKey && data.nonce) {
                    text = decryptMessage(data.ciphertext, data.nonce, peer.sessionKey) ?? data.ciphertext;
                }

                // Vérification de la signature
                if (data.signature && peer?.signingPublicKey) {
                    const isValid = verifySignature(text, data.signature, peer.signingPublicKey);
                    if (!isValid) {
                        console.warn(`[TCP] 🚨 Signature invalide de ${packet.nodeId.slice(0, 12)}… !`);
                        text = `⚠️ [NON SIGNÉ/FALSIFIÉ] ${text}`;
                    }
                }

                this.connections.set(packet.nodeId, socket);
                this.onMessageReceived({ from: packet.nodeId, message: text, timestamp: data.timestamp || Date.now(), encrypted: !!peer?.sessionKey });
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
                    message: `📦 Fichier disponible: ${data.manifest.file_name} (${(data.manifest.file_size / 1024 / 1024).toFixed(2)} MB) — tapez download ${data.manifest.file_id.slice(0, 8)} pour télécharger`,
                    timestamp: Date.now(),
                    encrypted: false,
                });
                break;
            }

            /* ── CHUNK_REQ : un pair demande un chunk ──────────────────── */
            case PacketType.CHUNK_REQ: {
                if (!data) return;
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

            /* ── CHUNK_DATA reçu ───────────────────────────────────────── */
            case PacketType.CHUNK_DATA: {
                if (!data) return;
                this.onChunkReceived(data);
                break;
            }

            /* ── RELAY reçu : on transporte ou on reçoit ? ────────────── */
            case PacketType.RELAY: {
                if (!data) return;

                // Si le message est pour NOUS
                if (data.target === this.identity.nodeId) {
                    console.log(`[TCP] 📨 Message RELAY reçu de ${data.sender.slice(0, 12)}…`);
                    this.onMessageReceived({
                        from: data.sender,
                        message: `[Relay] ${data.content}`,
                        timestamp: data.timestamp || Date.now(),
                        encrypted: false
                    });
                } else {
                    // Sinon, on le stocke pour le redonner plus tard (on devient relayeur)
                    console.log(`[TCP] 🔄 On accepte de relayer un message pour ${data.target.slice(0, 12)}…`);
                    queueRelayMessage(data.target, data.sender, data);
                }
                break;
            }

            /* ── ACK ───────────────────────────────────────────────────── */
            case PacketType.ACK:
                break;

            default:
                console.log(`[TCP] Paquet inconnu: ${PacketTypeName[packet.type] || packet.type}`);
        }
    }

    /* ── Délivre les messages stockés pour un pair ─────────────────── */
    _deliverRelayMessages(nodeId, socket) {
        const messages = fetchRelayMessages(nodeId);
        if (messages.length > 0) {
            console.log(`[TCP] 📤 Délivrance de ${messages.length} message(s) en attente pour ${nodeId.slice(0, 12)}…`);
            for (const msg of messages) {
                const packet = buildPacket(PacketType.RELAY, this.identity.nodeId, JSON.stringify(msg.packet_data), PUBLIC_HMAC_KEY);
                socket.write(packet);
            }
        }
    }

    /* ── Envoi TCP vers un pair ─────────────────────────────────────── */
    async sendTo(nodeId, packetBuf) {
        const peer = peerTable.get(nodeId);
        if (!peer) throw new Error(`Pair inconnu: ${nodeId}`);

        let socket = this.connections.get(nodeId);
        if (!socket || socket.destroyed) {
            socket = await this._connect(peer.ip, peer.tcpPort, nodeId);
        }

        return new Promise((resolve, reject) => {
            socket.write(packetBuf, err => err ? reject(err) : resolve());
        });
    }

    /* ── Nouvelle méthode : Force la connexion via IP (Découverte manuelle) ─── */
    async sendToIP(ip, port) {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: ip, port }, () => {
                socket.setKeepAlive(true, KEEPALIVE_INTERVAL);

                // On lui envoie notre HELLO pour qu'il nous découvre
                const hello = buildHelloPacket(this.identity, this._port, getLocalManifest());

                socket.write(hello);
                this._handleConnection(socket);
                resolve(socket);
            });
            socket.on('error', reject);
            setTimeout(() => reject(new Error('Timeout connexion IP')), 5000);
        });
    }

    /* ── Connexion sortante ─────────────────────────────────────────── */
    _connect(ip, port, nodeId) {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: ip, port }, () => {
                socket.setKeepAlive(true, KEEPALIVE_INTERVAL);
                this.connections.set(nodeId, socket);
                this._handleConnection(socket);

                // Délivrer les messages en attente de relais
                this._deliverRelayMessages(nodeId, socket);

                resolve(socket);
            });
            socket.on('error', reject);
            setTimeout(() => reject(new Error('Timeout connexion TCP')), 5000);
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
