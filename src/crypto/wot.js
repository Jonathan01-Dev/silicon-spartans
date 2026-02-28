/**
 * ARCHIPEL — Web of Trust (WoT) — Modèle TOFU
 * Trust On First Use : on fait confiance à la première clé vue,
 * et on alerte si elle change lors des contacts suivants (protection MITM).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WOT_FILE = path.join(__dirname, '../../.wot.json');

/**
 * Charge le Web of Trust depuis le disque
 * @returns {Object} Map nodeId -> { signingPub, dhPub, firstSeen, lastSeen, trusted }
 */
function load() {
    if (fs.existsSync(WOT_FILE)) {
        try { return JSON.parse(fs.readFileSync(WOT_FILE, 'utf-8')); } catch { /* ignore */ }
    }
    return {};
}

/**
 * Sauvegarde le Web of Trust sur le disque
 */
function save(wot) {
    fs.writeFileSync(WOT_FILE, JSON.stringify(wot, null, 2));
}

/**
 * Vérifie et enregistre un nœud selon le modèle TOFU.
 * @param {string} nodeId
 * @param {string} signingPub - Clé publique Ed25519 (hex)
 * @param {string} dhPub      - Clé publique X25519 (hex)
 * @returns {{ status: 'new'|'known'|'mismatch', trusted: boolean }}
 */
export function checkTrust(nodeId, signingPub, dhPub) {
    const wot = load();
    const entry = wot[nodeId];

    if (!entry) {
        // Premier contact → TOFU : on fait confiance
        wot[nodeId] = {
            signingPub,
            dhPub,
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            trusted: true,
        };
        save(wot);
        return { status: 'new', trusted: true };
    }

    // Contact connu → vérifie la cohérence des clés
    if (entry.signingPub !== signingPub || entry.dhPub !== dhPub) {
        console.warn(`[WOT] ⚠️  ALERTE MITM potentiel ! Clé changée pour ${nodeId.slice(0, 12)}…`);
        wot[nodeId].trusted = false;
        save(wot);
        return { status: 'mismatch', trusted: false };
    }

    // Clés identiques → met à jour lastSeen
    wot[nodeId].lastSeen = Date.now();
    save(wot);
    return { status: 'known', trusted: entry.trusted };
}

/**
 * Marque manuellement un nœud comme fiable (après vérification manuelle)
 */
export function trust(nodeId) {
    const wot = load();
    if (wot[nodeId]) {
        wot[nodeId].trusted = true;
        save(wot);
        return true;
    }
    return false;
}

/**
 * Retourne tous les nœuds connus dans le WoT
 */
export function listTrusted() {
    const wot = load();
    return Object.entries(wot).map(([nodeId, data]) => ({ nodeId, ...data }));
}

/**
 * Retourne l'état de confiance d'un nœud
 */
export function isTrusted(nodeId) {
    const wot = load();
    return wot[nodeId]?.trusted === true;
}
