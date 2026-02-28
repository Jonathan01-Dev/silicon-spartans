/**
 * ARCHIPEL — Protocole de Transfert de Fichiers (Sprint 3)
 * Gère l'envoi et la réception de chunks via TCP
 * Paquets : MANIFEST, CHUNK_REQ, CHUNK_DATA, ACK
 */

import path from 'path';
import { buildPacket, PacketType, PUBLIC_HMAC_KEY } from '../crypto/packet.js';
import { readChunk, assembleFile, verifyChunk } from './chunker.js';
import { getLocalManifest, saveRemoteManifest, DL_DIR } from './file-index.js';

/**
 * ÉMETTEUR — Envoie le manifest d'un fichier à un pair
 */
export async function sendManifest(tcpServer, nodeId, fileId, hmacKey = PUBLIC_HMAC_KEY) {
    const manifest = getLocalManifest(fileId);
    if (!manifest) throw new Error(`Fichier inconnu: ${fileId}`);

    const payload = JSON.stringify({ type: 'MANIFEST', manifest });
    const packet = buildPacket(PacketType.MANIFEST, nodeId, payload, hmacKey);
    await tcpServer.sendTo(nodeId, packet);
    console.log(`[TRANSFER] 📤 Manifest envoyé: ${manifest.file_name}`);
}

/**
 * ÉMETTEUR — Envoie un chunk spécifique à un pair
 */
export async function sendChunk(tcpServer, nodeId, fileId, chunkIndex, localIdentityNodeId, hmacKey = PUBLIC_HMAC_KEY) {
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

    const packet = buildPacket(PacketType.CHUNK_DATA, localIdentityNodeId, payload, hmacKey);
    await tcpServer.sendTo(nodeId, packet);
}

/**
 * RÉCEPTEUR — Demande un chunk à un pair
 */
export async function requestChunk(tcpServer, nodeId, fileId, chunkIndex, localIdentityNodeId, hmacKey = PUBLIC_HMAC_KEY) {
    const payload = JSON.stringify({
        type: 'CHUNK_REQ',
        file_id: fileId,
        chunk_index: chunkIndex,
    });
    const packet = buildPacket(PacketType.CHUNK_REQ, localIdentityNodeId, payload, hmacKey);
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

    // Demande tous les chunks (pipeline)
    for (let i = 0; i < manifest.chunk_count; i++) {
        await requestChunk(tcpServer, fromNodeId, manifest.file_id, i, localNodeId);
    }

    // Attend la réception de tous les chunks via un polling sur tcpServer
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout transfert — certains chunks non reçus'));
        }, 120_000); // 2 minutes max

        // Le TcpServer appellera ce handler quand des CHUNK_DATA arrivent
        const originalHandler = tcpServer.onChunkReceived;
        tcpServer.onChunkReceived = (data) => {
            if (data.file_id !== manifest.file_id) return;

            const chunkBuf = Buffer.from(data.data, 'base64');
            const chunkInfo = manifest.chunks[data.chunk_index];

            if (!verifyChunk(chunkBuf, chunkInfo.hash)) {
                console.warn(`[TRANSFER] ⚠️ Chunk ${data.chunk_index} corrompu — re-demande`);
                requestChunk(tcpServer, fromNodeId, manifest.file_id, data.chunk_index, localNodeId);
                return;
            }

            chunkBuffers[data.chunk_index] = chunkBuf;
            downloaded++;
            onProgress(downloaded, manifest.chunk_count);
            console.log(`[TRANSFER] ✅ Chunk ${data.chunk_index + 1}/${manifest.chunk_count}`);

            if (downloaded === manifest.chunk_count) {
                clearTimeout(timeout);
                tcpServer.onChunkReceived = originalHandler;
                try {
                    const outPath = assembleFile(manifest, chunkBuffers, DL_DIR);
                    console.log(`[TRANSFER] 🎉 Fichier complet: ${outPath}`);
                    resolve(outPath);
                } catch (err) {
                    reject(err);
                }
            }
        };
    });
}
