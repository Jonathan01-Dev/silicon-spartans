/**
 * ARCHIPEL — Intégration Gemini AI
 * 
 * Seule connexion Internet autorisée dans ARCHIPEL.
 * Activation : @archipel-ai <votre question>
 * Désactivation : --no-ai
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODEL = 'gemini-2.0-flash';

export class GeminiAssistant {
    constructor(apiKey) {
        this.enabled = !!apiKey;
        this.apiKey = apiKey;
        this.client = null;
        this.model = null;

        if (this.enabled) {
            try {
                this.client = new GoogleGenerativeAI(apiKey);
                this.model = this.client.getGenerativeModel({ model: GEMINI_MODEL });
            } catch (err) {
                console.warn('[GEMINI] ⚠️ Erreur initialisation:', err.message);
                this.enabled = false;
            }
        }
    }

    /**
     * Envoie une question à Gemini avec le contexte des messages récents
     * @param {string} question - Question de l'utilisateur
     * @param {string} chatContext - N derniers messages du chat
     * @returns {Promise<string>} Réponse de Gemini
     */
    async ask(question, chatContext = '') {
        if (!this.enabled) {
            return '❌ Gemini AI désactivé. Passez une clé API avec GEMINI_API_KEY ou retirez --no-ai.';
        }

        const systemPrompt = `Tu es l'assistant IA du protocole ARCHIPEL, un réseau P2P chiffré décentralisé.
Tu aides les développeurs et utilisateurs du réseau.
Contexte du protocole :
- UDP Multicast pour la découverte (239.255.42.99:6000)
- TCP sur port 7777 pour le transfert
- Chiffrement : Ed25519 (identité), X25519 ECDH (échange de clé), ChaCha20-Poly1305 (messages)
- Chunking : 512 KB par chunk, manifest JSON avec SHA256

Contexte récent du chat :
${chatContext || '(aucun message récent)'}

Réponds de façon concise et pratique.`;

        try {
            const result = await this.model.generateContent([
                { text: systemPrompt },
                { text: question },
            ]);
            return result.response.text();
        } catch (err) {
            return `❌ Erreur Gemini: ${err.message}`;
        }
    }

    /**
     * Vérifie si un message est destiné à Gemini
     */
    static isGeminiCommand(message) {
        return message.trim().startsWith('@archipel-ai');
    }

    /**
     * Extrait la question du message @archipel-ai
     */
    static extractQuestion(message) {
        return message.trim().replace(/^@archipel-ai\s*/i, '').trim();
    }
}
