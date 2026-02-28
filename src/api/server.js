/**
 * ARCHIPEL — Serveur API Web (Sprint 5)
 * Pont entre le moteur P2P et l'interface Web
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadOrCreateIdentity } from '../crypto/identity.js';
import { PeerDiscovery } from '../network/peer-discovery.js';
import { TcpServer } from '../network/tcp-server.js';
import { Messenger } from '../messaging/messenger.js';
import { peerTable } from '../network/peer-table.js';
import { initDatabase, getHistory } from '../database/db.js';
import { listAllFiles, indexSharedFiles } from '../transfer/file-index.js';
import { downloadFile } from '../transfer/transfer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const io = new Server(server);
const WEB_PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// ─── Initialisation du Moteur ARCHIPEL ─────────────────────────────────────────

async function startArchipelEngine() {
    await initDatabase();

    // Mission : Indexation des fichiers locaux pour partage décentralisé
    indexSharedFiles();

    const identity = loadOrCreateIdentity();

    const tcpServer = new TcpServer(identity, (msgInfo) => {
        // Envoi au frontend via Socket.io
        io.emit('new_message', msgInfo);
    });

    const tcpPort = await tcpServer.start();
    const discovery = new PeerDiscovery(identity, tcpPort, (peer) => {
        io.emit('new_peer', peer);
    });
    await discovery.start();

    const messenger = new Messenger(identity, tcpServer);

    // ─── Routes API ─────────────────────────────────────────────────────────────

    app.get('/api/status', (req, res) => {
        res.json({
            nodeId: identity.nodeId,
            tcpPort,
            peers: peerTable.getActivePeers().length,
            messages: messenger.getHistory().length
        });
    });

    app.get('/api/peers', (req, res) => {
        res.json(peerTable.getActivePeers());
    });

    app.get('/api/messages', (req, res) => {
        res.json(messenger.getHistory(100));
    });

    app.get('/api/files', (req, res) => {
        res.json(listAllFiles());
    });

    app.post('/api/send', async (req, res) => {
        const { nodeId, message } = req.body;
        if (!nodeId || !message) {
            return res.status(400).json({ error: "NodeId et Message requis" });
        }
        try {
            const result = await messenger.send(nodeId, message);

            // On signale au frontend (pour toutes les fenêtres ouvertes)
            io.emit('new_message', {
                from: 'MOI',
                to: nodeId,
                message: result.relayed ? `(Relais) ${message}` : message,
                timestamp: Date.now()
            });

            res.json({ success: true, ...result });
        } catch (err) {
            console.error(`[API] ❌ Erreur d'envoi:`, err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // Mission : Téléchargement P2P (Chunking) via API
    app.post('/api/download', async (req, res) => {
        const { fileId, fromNodeId } = req.body;
        const allFiles = listAllFiles();
        const file = allFiles.find(f => f.file_id === fileId && f.location === 'remote');

        if (!file) return res.status(404).json({ error: "Fichier non trouvé" });

        try {
            // Lancement du téléchargement parallèle (Mission : Chunking)
            downloadFile(tcpServer, fromNodeId, file, identity.nodeId, (downloaded, total) => {
                io.emit('download_progress', { fileId, downloaded, total });
            }).then(downloadPath => {
                io.emit('download_complete', { fileId, path: downloadPath });
            });

            res.json({ success: true, message: "Téléchargement lancé" });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    console.log(`[UI] 🚀 ARCHIPEL Engine prêt.`);
}

server.listen(WEB_PORT, () => {
    console.log(`[UI] 🌐 Interface accessible sur http://localhost:${WEB_PORT}`);
    startArchipelEngine().catch(console.error);
});
