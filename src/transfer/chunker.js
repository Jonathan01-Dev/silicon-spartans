/**
 * ARCHIPEL — Chunker (Sprint 3)
 * Découpe les fichiers en chunks de 512 KB avec vérification SHA-256
 */

import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';

export const CHUNK_SIZE = 512 * 1024; // 512 KB

/**
 * Génère un manifest JSON pour un fichier
 * @param {string} filePath - Chemin absolu du fichier
 * @returns {Object} Manifest
 */
export function createManifest(filePath) {
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const fileName = path.basename(filePath);
    const fd = fs.openSync(filePath, 'r');

    // Hash global du fichier
    const globalHasher = createHash('sha256');
    const chunks = [];
    let offset = 0;
    let index = 0;

    while (offset < fileSize) {
        const size = Math.min(CHUNK_SIZE, fileSize - offset);
        const buf = Buffer.alloc(size);
        fs.readSync(fd, buf, 0, size, offset);

        const chunkHash = createHash('sha256').update(buf).digest('hex');
        globalHasher.update(buf);
        chunks.push({ index, offset, size, hash: chunkHash });

        offset += size;
        index++;
    }

    fs.closeSync(fd);
    const fileId = createHash('sha256').update(fileName + fileSize).digest('hex');

    return {
        file_id: fileId,
        file_name: fileName,
        file_size: fileSize,
        chunk_size: CHUNK_SIZE,
        chunk_count: chunks.length,
        file_hash: globalHasher.digest('hex'),
        chunks,
        created_at: Date.now(),
    };
}

/**
 * Lit un chunk spécifique d'un fichier
 * @param {string} filePath
 * @param {number} chunkIndex
 * @returns {Buffer}
 */
export function readChunk(filePath, chunkIndex) {
    const stats = fs.statSync(filePath);
    const offset = chunkIndex * CHUNK_SIZE;
    const size = Math.min(CHUNK_SIZE, stats.size - offset);
    const buf = Buffer.alloc(size);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, size, offset);
    fs.closeSync(fd);
    return buf;
}

/**
 * Vérifie l'intégrité d'un chunk reçu
 * @param {Buffer} data
 * @param {string} expectedHash - SHA256 hex
 * @returns {boolean}
 */
export function verifyChunk(data, expectedHash) {
    const actualHash = createHash('sha256').update(data).digest('hex');
    return actualHash === expectedHash;
}

/**
 * Réassemble les chunks en fichier final dans outputDir
 * @param {Object}   manifest
 * @param {Buffer[]} chunkBuffers - Tableaux indexés par index de chunk
 * @param {string}   outputDir
 * @returns {string} Chemin du fichier reconstitué
 */
export function assembleFile(manifest, chunkBuffers, outputDir) {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outPath = path.join(outputDir, manifest.file_name);
    const fd = fs.openSync(outPath, 'w');

    for (let i = 0; i < manifest.chunk_count; i++) {
        const buf = chunkBuffers[i];
        if (!buf) throw new Error(`Chunk ${i} manquant`);
        // Vérifie l'intégrité
        if (!verifyChunk(buf, manifest.chunks[i].hash)) {
            throw new Error(`Chunk ${i} corrompu !`);
        }
        fs.writeSync(fd, buf, 0, buf.length, manifest.chunks[i].offset);
    }

    fs.closeSync(fd);

    // Vérifie le hash global
    const finalHash = createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
    if (finalHash !== manifest.file_hash) {
        fs.unlinkSync(outPath);
        throw new Error('Hash global du fichier invalide — fichier corrompu');
    }

    return outPath;
}
