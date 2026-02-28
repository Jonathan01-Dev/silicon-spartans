/**
 * ARCHIPEL — Protocole de Transfert de Fichiers (Sprint 3)
 * Gère l'envoi et la réception de chunks via TCP
 * Paquets : MANIFEST, CHUNK_REQ, CHUNK_DATA, ACK
 */

import path from 'path';
import { buildPacket, PacketType, PUBLIC_HMAC_KEY } from '../crypto/packet.js';
import { readChunk, assembleFile, verifyChunk } from './chunker.js';
import { getLocalManifest, saveRemoteManifest, DL_DIR } from './file-index.js';
import { peerTable } from '../network/peer-table.js';

/**
 * Récupère la meilleure clé HMAC pour communiquer avec un pair
 */
function getHmacKeyFor(nodeId) {
    const peer = peerTable.get(nodeId);
    return peer?.sessionKey || PUBLIC_HMAC_KEY;
}

/**
 * ÉMETTEUR — Envoie le manifest d'un fichier à un pair
 */
export async function sendManifest(tcpServer, nodeId, fileId, hmacKey = PUBLIC_HMAC_KEY) {
    const manifest = getLocalManifest(fileId);
    if (!manifest) throw new Error(`Fichier inconnu: ${fileId}`);

    const payload = JSON.stringify({ type: 'MANIFEST', manifest });
    const key = hmacKey === PUBLIC_HMAC_KEY ? getHmacKeyFor(nodeId) : hmacKey;
    const packet = buildPacket(PacketType.MANIFEST, tcpServer.identity.nodeId, payload, key);
    await tcpServer.sendTo(nodeId, packet);
    console.log(`[TRANSFER] 📤 Manifest envoyé: ${manifest.file_name}`);
}

/**
 * ÉMETTEUR — Envoie un chunk spécifique à un pair
 */
export async function sendChunk(tcpServer, nodeId, fileId, chunkIndex, localIdentityNodeId, hmacKey = null) {
    const manifest = getLocalManifest(fileId);
    if (!manifest) throw new Error(`Fichier inconnu: ${fileId}`);

    const chunkInfo = manifest.chunks[chunkIndex];
    if (!chunkInfo) throw new Error(`Chunk ${chunkIndex} introuvable`);

    const data = readChunk(manifest.path, chunkIndex);

    const payload = JSON.stringify({
        type: 'CHUNK_DATA',
        file_id: fileId,
        chunk_index: chunkIndex,
        hash: chunkInfo.hash,
        data: data.toString('base64'),
    });

    const key = hmacKey || getHmacKeyFor(nodeId);
    const packet = buildPacket(PacketType.CHUNK_DATA, localIdentityNodeId, payload, key);
    await tcpServer.sendTo(nodeId, packet);
}

/**
 * RÉCEPTEUR — Demande un chunk à un pair
 */
export async function requestChunk(tcpServer, nodeId, fileId, chunkIndex, localIdentityNodeId, hmacKey = null) {
    const payload = JSON.stringify({
        type: 'CHUNK_REQ',
        file_id: fileId,
        chunk_index: chunkIndex,
    });
    const key = hmacKey || getHmacKeyFor(nodeId);
    const packet = buildPacket(PacketType.CHUNK_REQ, localIdentityNodeId, payload, key);
    await tcpServer.sendTo(nodeId, packet);
}

/**
 * RÉCEPTEUR — Télécharge un fichier complet depuis un pair (swarming)
 * @param {Object}   tcpServer
 * @param {string}   fromNodeId  - Pair source
 * @param {Object}   manifest    - Manifest du fichier à télécharger
 * @param {string}   localNodeId
 * @param {Function} onProgress  - Callback (downloaded, total)
 * @returns {Promise<string>} Chemin du fichier téléchargé
 */
export async function downloadFile(tcpServer, fromNodeId, manifest, localNodeId, onProgress = () => { }) {
    saveRemoteManifest(manifest, fromNodeId);

    const chunkBuffers = new Array(manifest.chunk_count).fill(null);
    let downloaded = 0;

    console.log(`[TRANSFER] 📥 Téléchargement: ${manifest.file_name} (${(manifest.file_size / 1024 / 1024).toFixed(2)} MB, ${manifest.chunk_count} chunks)`);

    const chunkHandlers = tcpServer._chunkHandlers || {};
    tcpServer._chunkHandlers = chunkHandlers;

    // Demande tous les chunks (pipeline)
    for (let i = 0; i < manifest.chunk_count; i++) {
        await requestChunk(tcpServer, fromNodeId, manifest.file_id, i, localNodeId);
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            delete chunkHandlers[manifest.file_id];
            reject(new Error('Timeout transfert — certains chunks non reçus'));
        }, 120_000);

        chunkHandlers[manifest.file_id] = (data) => {
            const chunkBuf = Buffer.from(data.data, 'base64');
            const chunkInfo = manifest.chunks[data.chunk_index];

            if (!verifyChunk(chunkBuf, chunkInfo.hash)) {
                requestChunk(tcpServer, fromNodeId, manifest.file_id, data.chunk_index, localNodeId);
                return;
            }

            if (chunkBuffers[data.chunk_index]) return; // Déjà reçu

            chunkBuffers[data.chunk_index] = chunkBuf;
            downloaded++;
            onProgress(downloaded, manifest.chunk_count);

            if (downloaded === manifest.chunk_count) {
                clearTimeout(timeout);
                delete chunkHandlers[manifest.file_id];
                try {
                    const outPath = assembleFile(manifest, chunkBuffers, DL_DIR);
                    resolve(outPath);
                } catch (err) { reject(err); }
            }
        };
    });
}
