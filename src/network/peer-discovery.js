/**
 * ARCHIPEL — Peer Discovery (UDP Multicast)
 * 
 * Découverte automatique des nœuds sur le réseau local.
 * - Multicast address : 239.255.42.99:6000
 * - Émission HELLO toutes les 30s
 * - Timeout nœud : 90s sans signal
 */

import dgram from 'dgram';
import { buildHelloPacket, parsePacket, parseJsonPayload, PacketType, PUBLIC_HMAC_KEY } from '../crypto/packet.js';
import { peerTable } from './peer-table.js';
import { getSharedFileSummaries } from '../transfer/file-index.js';

const MULTICAST_ADDR = '239.255.42.99';
const MULTICAST_PORT = 6000;
const HELLO_INTERVAL_MS = 30_000; // 30 secondes

export class PeerDiscovery {
    constructor(identity, tcpPort, onPeerDiscovered) {
        this.identity = identity;
        this.tcpPort = tcpPort;
        this.onPeerDiscovered = onPeerDiscovered || (() => { });
        this.socket = null;
        this.helloInterval = null;
        // Clé HMAC publique pour les paquets de découverte (connue de tous)
        this.publicHmacKey = PUBLIC_HMAC_KEY;
    }

    /**
     * Démarre le service de découverte UDP Multicast
     */
    start() {
        return new Promise((resolve, reject) => {
            this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            this.socket.on('error', (err) => {
                console.error('[DISCOVERY] ❌ Erreur UDP:', err.message);
                reject(err);
            });

            this.socket.on('message', (msg, rinfo) => {
                this._handleIncoming(msg, rinfo);
            });

            this.socket.bind(MULTICAST_PORT, () => {
                try {
                    this.socket.addMembership(MULTICAST_ADDR);
                    this.socket.setMulticastTTL(128);
                    console.log(`[DISCOVERY] ✅ UDP Multicast actif sur ${MULTICAST_ADDR}:${MULTICAST_PORT}`);

                    // Envoi immédiat d'un HELLO, puis toutes les 30s
                    this._sendHello();
                    this.helloInterval = setInterval(() => this._sendHello(), HELLO_INTERVAL_MS);

                    // Nettoyage des pairs morts toutes les 30s
                    this.pruneInterval = setInterval(() => {
                        const removed = peerTable.pruneDeadPeers();
                        if (removed.length > 0) {
                            console.log(`[DISCOVERY] 🔴 Nœuds morts supprimés: ${removed.length}`);
                        }
                    }, 30_000);

                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    /**
     * Envoie un paquet HELLO en broadcast multicast
     */
    _sendHello() {
        const sharedFiles = getSharedFileSummaries();
        const packet = buildHelloPacket(this.identity, this.tcpPort, sharedFiles);
        this.socket.send(packet, MULTICAST_PORT, MULTICAST_ADDR, (err) => {
            if (err) console.error('[DISCOVERY] ❌ Erreur envoi HELLO:', err.message);
            else console.log('[DISCOVERY] 📡 HELLO envoyé');
        });
    }

    /**
     * Traite les paquets UDP entrants
     */
    _handleIncoming(buf, rinfo) {
        const packet = parsePacket(buf, this.publicHmacKey);
        if (!packet) return;

        // Ignore ses propres messages
        if (packet.nodeId === this.identity.nodeId) return;

        if (packet.type === PacketType.HELLO) {
            const data = parseJsonPayload(packet);
            if (!data) return;

            const peerInfo = {
                nodeId: data.nodeId,
                ip: rinfo.address,
                tcpPort: data.tcpPort,
                dhPublicKey: data.dhPublicKey,
                signingPublicKey: data.signingPublicKey,
                sharedFiles: data.sharedFiles || [],
            };

            const isNew = !peerTable.get(peerInfo.nodeId);
            peerTable.upsert(peerInfo);

            if (isNew) {
                console.log(`[DISCOVERY] 🟢 Nouveau nœud: ${peerInfo.nodeId.slice(0, 12)}… @ ${peerInfo.ip}:${peerInfo.tcpPort}`);
                this.onPeerDiscovered(peerInfo);
            }
        }
    }

    /**
     * Arrête le service de découverte
     */
    stop() {
        if (this.helloInterval) clearInterval(this.helloInterval);
        if (this.pruneInterval) clearInterval(this.pruneInterval);
        if (this.socket) {
            this.socket.dropMembership(MULTICAST_ADDR);
            this.socket.close();
        }
        console.log('[DISCOVERY] 🔴 Service arrêté');
    }
}
