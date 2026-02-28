/**
 * ARCHIPEL — Persistance SQLite (via sql.js)
 * Gère le stockage des messages et des pairs de confiance.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, '../../archipel.db');

let db = null;

/**
 * Initialise la base de données
 */
export async function initDatabase() {
    if (db) return db;

    const SQL = await initSqlJs();

    if (fs.existsSync(DB_FILE)) {
        const fileBuffer = fs.readFileSync(DB_FILE);
        db = new SQL.Database(fileBuffer);
        console.log('[DB] ✅ Base de données chargée depuis archipel.db');
    } else {
        db = new SQL.Database();
        // Initialiser le schéma
        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                peer_id TEXT,
                sender TEXT,
                content TEXT,
                timestamp INTEGER,
                encrypted INTEGER
            );
            CREATE TABLE IF NOT EXISTS peers (
                node_id TEXT PRIMARY KEY,
                public_key_dh TEXT,
                public_key_signing TEXT,
                last_seen INTEGER,
                trust_level INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS relay_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_id TEXT,
                sender_id TEXT,
                packet_data TEXT, -- JSON string du paquet chiffré
                expires_at INTEGER
            );
        `);
        persist();
        console.log('[DB] ✨ Nouvelle base de données créée');
    }
    return db;
}

/**
 * Sauvegarde la base de données sur le disque
 */
export function persist() {
    if (!db) return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
}

/**
 * Enregistre un message dans l'historique
 */
export function saveMessage(peerId, sender, content, encrypted) {
    if (!db) return;
    db.run(
        "INSERT INTO messages (peer_id, sender, content, timestamp, encrypted) VALUES (?, ?, ?, ?, ?)",
        [peerId, sender, content, Date.now(), encrypted ? 1 : 0]
    );
    persist();
}

/**
 * Récupère l'historique des messages avec un pair
 */
export function getHistory(peerId = null, limit = 50) {
    if (!db) return [];

    let query = "SELECT * FROM messages";
    let params = [];

    if (peerId) {
        query += " WHERE peer_id = ?";
        params.push(peerId);
    }

    query += " ORDER BY timestamp ASC LIMIT ?";
    params.push(limit);

    const res = db.exec(query, params);
    if (res.length === 0) return [];

    const columns = res[0].columns;
    return res[0].values.map(row => {
        let obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    });
}

/**
 * Enregistre/Met à jour un pair de confiance
 */
export function upsertPeer(nodeId, pkDh, pkSigning, trustLevel = 0) {
    if (!db) return;
    db.run(
        `INSERT INTO peers (node_id, public_key_dh, public_key_signing, last_seen, trust_level) 
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET 
            last_seen = excluded.last_seen,
            public_key_dh = excluded.public_key_dh,
            public_key_signing = excluded.public_key_signing;`,
        [nodeId, pkDh, pkSigning, Date.now(), trustLevel]
    );
    persist();
}

/**
 * RELAIS : Ajoute un paquet en attente de transmission
 */
export function queueRelayMessage(targetId, senderId, packetData, ttlHours = 24) {
    if (!db) return;
    const expiresAt = Date.now() + (ttlHours * 3600 * 1000);
    db.run(
        "INSERT INTO relay_queue (target_id, sender_id, packet_data, expires_at) VALUES (?, ?, ?, ?)",
        [targetId, senderId, JSON.stringify(packetData), expiresAt]
    );
    persist();
}

/**
 * RELAIS : Récupère les paquets en attente pour un pair spécifique
 */
export function fetchRelayMessages(targetId) {
    if (!db) return [];

    // Nettoyage des expirés
    db.run("DELETE FROM relay_queue WHERE expires_at < ?", [Date.now()]);

    const res = db.exec("SELECT * FROM relay_queue WHERE target_id = ?", [targetId]);
    if (res.length === 0) return [];

    const columns = res[0].columns;
    const messages = res[0].values.map(row => {
        let obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        obj.packet_data = JSON.parse(obj.packet_data);
        return obj;
    });

    // Supprimer après récupération (une seule tentative de remise par ce noeud)
    db.run("DELETE FROM relay_queue WHERE target_id = ?", [targetId]);
    persist();

    return messages;
}

/**
 * Récupère les pairs enregistrés
 */
export function getStoredPeers() {
    if (!db) return [];
    const res = db.exec("SELECT * FROM peers");
    if (res.length === 0) return [];
    const columns = res[0].columns;
    return res[0].values.map(row => {
        let obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    });
}
