/**
 * ARCHIPEL — Index local des fichiers partagés
 * Stockage JSON simple (index.json) — pas besoin de SQLite
 * Indexe les fichiers disponibles localement et les manifests reçus
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createManifest } from './chunker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.join(__dirname, '../../.index.json');
const SHARE_DIR = path.join(__dirname, '../../shared');
const DL_DIR = path.join(__dirname, '../../downloads');

// Crée les dossiers s'ils n'existent pas
if (!fs.existsSync(SHARE_DIR)) fs.mkdirSync(SHARE_DIR, { recursive: true });
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

/**
 * Charge l'index depuis le disque
 */
function loadIndex() {
    if (fs.existsSync(INDEX_FILE)) {
        try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')); } catch { /* ignore */ }
    }
    return { shared: {}, received: {} };
}

/**
 * Sauvegarde l'index sur le disque
 */
function saveIndex(index) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * Indexe tous les fichiers du dossier shared/
 * @returns {Object[]} Liste des manifests
 */
export function indexSharedFiles() {
    const index = loadIndex();
    const files = fs.readdirSync(SHARE_DIR).filter(f => {
        const stat = fs.statSync(path.join(SHARE_DIR, f));
        return stat.isFile();
    });

    const manifests = [];
    for (const filename of files) {
        const filePath = path.join(SHARE_DIR, filename);
        const manifest = createManifest(filePath);
        index.shared[manifest.file_id] = { ...manifest, path: filePath };
        manifests.push(manifest);
    }

    saveIndex(index);
    return manifests;
}

/**
 * Retourne le manifest d'un fichier local par son file_id
 */
export function getLocalManifest(fileId) {
    const index = loadIndex();
    return index.shared[fileId] || null;
}

/**
 * Enregistre un manifest reçu d'un pair
 */
export function saveRemoteManifest(manifest, fromNodeId) {
    const index = loadIndex();
    index.received[manifest.file_id] = { ...manifest, fromNodeId, receivedAt: Date.now() };
    saveIndex(index);
}

/**
 * Retourne tous les fichiers disponibles (locaux + distants)
 */
export function listAllFiles() {
    const index = loadIndex();
    const local = Object.values(index.shared).map(m => ({ ...m, location: 'local' }));
    const remote = Object.values(index.received).map(m => ({ ...m, location: 'remote' }));
    return [...local, ...remote];
}

/**
 * Retourne les manifests des fichiers locaux (pour HELLO broadcast)
 */
export function getSharedFileSummaries() {
    const index = loadIndex();
    return Object.values(index.shared).map(m => ({
        file_id: m.file_id,
        file_name: m.file_name,
        file_size: m.file_size,
        chunk_count: m.chunk_count,
    }));
}

export { SHARE_DIR, DL_DIR };
