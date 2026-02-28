/**
 * ARCHIPEL — CLI Principal
 * 
 * Interface en ligne de commande interactive.
 * Commandes : start, peers, msg, send, receive, download, ai
 */

import readline from 'readline';
import chalk from 'chalk';
import { loadOrCreateIdentity } from '../crypto/identity.js';
import { PeerDiscovery } from '../network/peer-discovery.js';
import { TcpServer } from '../network/tcp-server.js';
import { peerTable } from '../network/peer-table.js';
import { Messenger } from '../messaging/messenger.js';
import { GeminiAssistant } from '../messaging/gemini.js';
import { initDatabase, persist } from '../database/db.js';
import { indexSharedFiles, listAllFiles } from '../transfer/file-index.js';
import { sendManifest, downloadFile } from '../transfer/transfer.js';

// ─── Configuration ────────────────────────────────────────────────────────────
const NO_AI = process.argv.includes('--no-ai');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;

// ─── Bannière ASCII ───────────────────────────────────────────────────────────
function printBanner() {
    const banner = `
${chalk.cyan('╔═══════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('  █████╗ ██████╗  ██████╗██╗  ██╗██╗██████╗ ███████╗')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ██╔══██╗██╔══██╗██╔════╝██║  ██║██║██╔══██╗██╔════╝')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ███████║██████╔╝██║     ███████║██║██████╔╝█████╗  ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ██╔══██║██╔══██╗██║     ██╔══██║██║██╔═══╝ ██╔══╝  ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ██║  ██║██║  ██║╚██████╗██║  ██║██║██║     ███████╗')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white(' ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚══════╝')}  ${chalk.cyan('║')}
${chalk.cyan('║')}                                                       ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.yellow('P2P Chiffré · Décentralisé · Zéro-Connexion Internet')}   ${chalk.cyan('║')}
${chalk.cyan('║')}           ${chalk.gray('LBS Hackathon 2026 — The Geek & The Moon')}          ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════════════╝')}
`;
    console.log(banner);
}

// ─── Aide ─────────────────────────────────────────────────────────────────────
function printHelp() {
    console.log(`
${chalk.bold.cyan('COMMANDES DISPONIBLES :')}

  ${chalk.green('peers')}                        → Affiche les nœuds actifs découverts
  ${chalk.green('msg')} ${chalk.yellow('<nodeId>')} ${chalk.white('<message>')}     → Envoie un message à un pair
  ${chalk.green('msg')} ${chalk.yellow('<n>')} ${chalk.white('<message>')}           → Envoie par numéro de pair (ex: msg 1 Bonjour)
  ${chalk.green('history')}                      → Affiche l'historique des messages
  ${chalk.green('whoami')}                       → Affiche votre identité (NODE_ID)
  ${chalk.green('status')}                       → Statut du nœud (connexions, pairs, etc.)
  ${chalk.green('@archipel-ai')} ${chalk.white('<question>')}  → Pose une question à l'assistant Gemini
  ${chalk.green('files')}                        → Liste les fichiers dispo (locaux et distants)
  ${chalk.green('share')} ${chalk.yellow('<fileId>')} ${chalk.white('<nodeId>')}   → Envoie un manifest à un pair
  ${chalk.green('download')} ${chalk.yellow('<fileId>')}         → Télécharge un fichier depuis un pair
  ${chalk.green('help')}                         → Affiche cette aide
  ${chalk.green('exit')}                         → Arrête le nœud

${chalk.gray('Exemple: msg 1 Bonjour le réseau !')}
${chalk.gray('Exemple: @archipel-ai Comment fonctionne le chunking ?')}
`);
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────
async function main() {
    printBanner();

    // Initialisation de la base de données
    console.log(chalk.gray('[*] Initialisation de la base de données...'));
    await initDatabase();

    // Chargement de l'identité
    console.log(chalk.gray('[*] Chargement de l\'identité cryptographique...'));
    const identity = loadOrCreateIdentity();
    console.log(chalk.green(`[✓] NODE_ID: ${identity.nodeId.slice(0, 24)}…`));
    console.log(chalk.green(`[✓] Clé publique Ed25519 chargée`));
    console.log(chalk.green(`[✓] Clé publique X25519 chargée\n`));

    // Indexation des fichiers locaux partagés
    console.log(chalk.gray('[*] Indexation des fichiers (dossier shared/)...'));
    const manifests = indexSharedFiles();
    console.log(chalk.green(`[✓] ${manifests.length} fichier(s) partagé(s) localement\n`));

    // Initialisation de Gemini
    const gemini = NO_AI ? new GeminiAssistant(null) : new GeminiAssistant(GEMINI_API_KEY);
    if (!NO_AI && GEMINI_API_KEY) {
        console.log(chalk.green('[✓] Gemini AI activé (@archipel-ai)'));
    } else if (!NO_AI) {
        console.log(chalk.yellow('[!] Gemini AI : définissez GEMINI_API_KEY pour l\'activer'));
    } else {
        console.log(chalk.gray('[*] Gemini AI désactivé (--no-ai)'));
    }

    // Démarrage du serveur TCP
    const tcpServer = new TcpServer(identity, (msgInfo) => {
        const shortId = msgInfo.from.slice(0, 12);
        const lock = msgInfo.encrypted ? chalk.green('🔒') : chalk.red('🔓');
        console.log(`\n${lock} ${chalk.cyan(`[${shortId}…]`)} ${msgInfo.message}`);
        messenger.receive(msgInfo);
        process.stdout.write(chalk.gray('archipel> '));
    });

    const tcpPort = await tcpServer.start();

    // Démarrage de la découverte UDP
    const discovery = new PeerDiscovery(identity, tcpPort, async (peer) => {
        console.log(`\n${chalk.green('🟢 Nouveau pair découvert !')} ${peer.ip}:${peer.tcpPort}`);

        // Tentative automatique de connexion pour livrer d'éventuels messages en attente (Relais)
        try {
            await tcpServer.sendTo(peer.nodeId, Buffer.alloc(0)); // Poke TCP (ACK/Empty) pour déclencher _deliverRelayMessages
        } catch (e) { /* ignore */ }

        process.stdout.write(chalk.gray('archipel> '));
    });

    await discovery.start();

    // Initialisation du messenger
    const messenger = new Messenger(identity, tcpServer);

    console.log(chalk.bold('\n✅ Nœud ARCHIPEL démarré ! Tapez "help" pour la liste des commandes.\n'));

    // ─── Interface CLI Interactive ─────────────────────────────────────────────
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.gray('archipel> '),
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }

        const parts = input.split(' ');
        const cmd = parts[0].toLowerCase();

        try {
            // ── @archipel-ai ────────────────────────────────────────────────────
            if (GeminiAssistant.isGeminiCommand(input)) {
                const question = GeminiAssistant.extractQuestion(input);
                if (!question) {
                    console.log(chalk.yellow('Usage: @archipel-ai <votre question>'));
                } else {
                    console.log(chalk.gray('[Gemini] 🤔 Réflexion en cours...'));
                    const context = messenger.getGeminiContext(10);
                    const response = await gemini.ask(question, context);
                    console.log(chalk.magenta(`\n[Gemini] 🤖 ${response}\n`));
                }
            }

            // ── peers ────────────────────────────────────────────────────────────
            else if (cmd === 'peers') {
                const peers = peerTable.getActivePeers();
                if (peers.length === 0) {
                    console.log(chalk.yellow('  Aucun pair découvert. En attente de nœuds sur le LAN…'));
                } else {
                    console.log(chalk.bold(`\n📡 ${peers.length} pair(s) actif(s) :`));
                    console.log(peerTable.display());
                    console.log();
                }
            }

            // ── msg <n|nodeId> <message> ─────────────────────────────────────────
            else if (cmd === 'msg') {
                if (parts.length < 3) {
                    console.log(chalk.yellow('Usage: msg <n|nodeId> <message>'));
                } else {
                    const target = parts[1];
                    const message = parts.slice(2).join(' ');

                    // Résolution par numéro ou nodeId
                    let nodeId = target;
                    const peers = peerTable.getActivePeers();
                    const byNumber = parseInt(target);
                    if (!isNaN(byNumber) && byNumber >= 1 && byNumber <= peers.length) {
                        nodeId = peers[byNumber - 1].nodeId;
                    }

                    const result = await messenger.send(nodeId, message);
                    const lock = result.encrypted ? chalk.green('🔒 chiffré') : chalk.red('🔓 non chiffré');
                    console.log(chalk.green(`✓ Message envoyé à ${nodeId.slice(0, 12)}… (${lock})`));
                }
            }

            // ── history ──────────────────────────────────────────────────────────
            else if (cmd === 'history') {
                const hist = messenger.getHistory();
                if (hist.length === 0) {
                    console.log(chalk.yellow('  Aucun message dans l\'historique.'));
                } else {
                    console.log(chalk.bold('\n📜 Historique des messages :'));
                    hist.forEach(m => {
                        const time = new Date(m.timestamp).toLocaleTimeString();
                        const who = m.from === 'MOI' ? chalk.cyan('MOI') : chalk.yellow(m.from.slice(0, 8) + '…');
                        const lock = m.encrypted ? chalk.green('🔒') : chalk.red('🔓');
                        console.log(`  ${chalk.gray(time)} ${lock} ${who}: ${m.message}`);
                    });
                    console.log();
                }
            }

            // ── whoami ───────────────────────────────────────────────────────────
            else if (cmd === 'whoami') {
                console.log(`\n${chalk.bold('🪪 Votre identité ARCHIPEL :')}`);
                console.log(`  NODE_ID     : ${chalk.cyan(identity.nodeId)}`);
                console.log(`  Signing Key : ${chalk.gray(identity.signing.publicKey.slice(0, 32) + '…')}`);
                console.log(`  DH Key      : ${chalk.gray(identity.dh.publicKey.slice(0, 32) + '…')}\n`);
            }

            // ── status ───────────────────────────────────────────────────────────
            else if (cmd === 'status') {
                const peers = peerTable.getActivePeers();
                console.log(`\n${chalk.bold('📊 Statut du nœud :')}`);
                console.log(`  TCP Port    : ${chalk.green(tcpPort)}`);
                console.log(`  Pairs actifs: ${chalk.green(peers.length)}`);
                console.log(`  Messages    : ${chalk.green(messenger.getHistory().length)}`);
                console.log(`  Gemini AI   : ${gemini.enabled ? chalk.green('activé') : chalk.red('désactivé')}\n`);
            }

            // ── files ────────────────────────────────────────────────────────────
            else if (cmd === 'files') {
                const files = listAllFiles();
                if (files.length === 0) {
                    console.log(chalk.yellow('  Aucun fichier partagé sur le réseau.'));
                } else {
                    console.log(chalk.bold('\n📁 Fichiers disponibles :'));
                    files.forEach(f => {
                        const icon = f.location === 'local' ? chalk.green('🏠') : chalk.cyan('☁️');
                        const sizeMB = (f.file_size / 1024 / 1024).toFixed(2);
                        console.log(`  ${icon} ${chalk.white(f.file_name)} ${chalk.gray(`(${sizeMB} MB)`)}`);
                        console.log(`     ID: ${chalk.yellow(f.file_id.slice(0, 16))}…`);
                        if (f.location === 'remote') {
                            console.log(`     Dispo chez: ${chalk.gray(f.fromNodeId.slice(0, 12))}…`);
                        }
                    });
                    console.log();
                }
            }

            // ── share <fileId> <n|nodeId> ────────────────────────────────────────
            else if (cmd === 'share') {
                if (parts.length < 3) {
                    console.log(chalk.yellow('Usage: share <fileId> <n|nodeId>'));
                } else {
                    const fileIdPrefix = parts[1];
                    let target = parts[2];

                    // Résolution du fileId
                    const allFiles = listAllFiles().filter(f => f.location === 'local');
                    const file = allFiles.find(f => f.file_id.startsWith(fileIdPrefix));
                    if (!file) {
                        console.log(chalk.red(`❌ Fichier local introuvable avec l'ID: ${fileIdPrefix}`));
                    } else {
                        // Résolution du nœud
                        let nodeId = target;
                        const peers = peerTable.getActivePeers();
                        const byNumber = parseInt(target);
                        if (!isNaN(byNumber) && byNumber >= 1 && byNumber <= peers.length) {
                            nodeId = peers[byNumber - 1].nodeId;
                        }
                        await sendManifest(tcpServer, nodeId, file.file_id);
                        console.log(chalk.green(`✓ Manifest de "${file.file_name}" envoyé à ${nodeId.slice(0, 12)}…`));
                    }
                }
            }

            // ── download <fileId> ────────────────────────────────────────────────
            else if (cmd === 'download') {
                if (parts.length < 2) {
                    console.log(chalk.yellow('Usage: download <fileId>'));
                } else {
                    const fileIdPrefix = parts[1];
                    const allFiles = listAllFiles();
                    const file = allFiles.find(f => f.file_id.startsWith(fileIdPrefix) && f.location === 'remote');

                    if (!file) {
                        console.log(chalk.red(`❌ Fichier distant introuvable avec l'ID: ${fileIdPrefix}`));
                    } else {
                        console.log(chalk.cyan(`📥 Démarrage du téléchargement de ${file.file_name}…`));
                        try {
                            const outPath = await downloadFile(tcpServer, file.fromNodeId, file, identity.nodeId, (dl, total) => {
                                process.stdout.write(`\r[TRANSFER] ⏳ Progression: ${dl}/${total} chunks`);
                            });
                            console.log(chalk.green(`\n✓ Téléchargement terminé: ${outPath}`));
                        } catch (err) {
                            console.log(chalk.red(`\n❌ Échec du téléchargement: ${err.message}`));
                        }
                    }
                }
            }

            // ── help ─────────────────────────────────────────────────────────────
            else if (cmd === 'help') {
                printHelp();
            }

            // ── exit ─────────────────────────────────────────────────────────────
            else if (cmd === 'exit' || cmd === 'quit') {
                console.log(chalk.yellow('\n👋 Arrêt du nœud ARCHIPEL…'));
                discovery.stop();
                tcpServer.stop();
                rl.close();
                process.exit(0);
            }

            // ── Commande inconnue ─────────────────────────────────────────────────
            else {
                console.log(chalk.red(`Commande inconnue: "${cmd}". Tapez "help" pour de l'aide.`));
            }

        } catch (err) {
            console.error(chalk.red(`❌ Erreur: ${err.message}`));
        }

        rl.prompt();
    });

    rl.on('close', () => {
        console.log(chalk.yellow('\n👋 Au revoir !'));
        process.exit(0);
    });
}

main().catch(console.error);
