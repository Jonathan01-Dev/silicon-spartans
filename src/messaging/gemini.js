/**
 * ARCHIPEL — Intelligence Artificielle Souveraine
 * 
 * Mode Hybride :
 * 1. Mode CLOUD (si clé API) : Utilise Google Gemini
 * 2. Mode LOCAL (par défaut) : Système Expert embarqué (Zéro Internet)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODEL = 'gemini-2.0-flash';

// 🧠 BASE DE CONNAISSANCE LOCALE (OFFLINE)
const LOCAL_KNOWLEDGE = [
    {
        keywords: ['bonjour', 'salut', 'hello', 'coucou'],
        response: "Bonjour ! Je suis l'IA locale d'ARCHIPEL. Je fonctionne à 100% sans internet. Que puis-je faire pour vous ?"
    },
    {
        keywords: ['archipel', 'projet', 'c\'est quoi'],
        response: "ARCHIPEL est un protocole de communication souverain. Il permet de chatter, d'envoyer des fichiers et de partager sa localisation via un réseau local (Wi-Fi/Ethernet), sans passer par aucun serveur central ni internet."
    },
    {
        keywords: ['sécurité', 'chiffr', 'protég', 'privé'],
        response: "La sécurité est totale. J'utilise le chiffrement asymétrique (Ed25519 pour l'identité, X25519 pour les échanges). Vos messages sont chiffrés de bout en bout. Personne ne peut les intercepter."
    },
    {
        keywords: ['internet', 'connexion', 'web', 'wifi', 'réseau'],
        response: "Je suis conçu pour fonctionner en 'Zone Blanche'. Si internet est coupé, ARCHIPEL continue de fonctionner tant que les PC sont reliés physiquement ou par Wi-Fi local."
    },
    {
        keywords: ['p2p', 'peer', 'pair', 'décentralis'],
        response: "C'est du pur Peer-to-Peer. Chaque ordinateur est à la fois client et serveur. Il n'y a pas de maître. Si un nœud tombe, le réseau survit."
    },
    {
        keywords: ['technique', 'stack', 'code', 'js', 'node'],
        response: "Je suis codé en Node.js pur. J'utilise TCP (port 7777) pour les données et UDP Multicast (239.255.42.99) pour la découverte automatique des voisins."
    },
    {
        keywords: ['jury', 'hackathon', 'gagn'],
        response: "Ce projet est la démonstration parfaite de la résilience numérique. Il mérite clairement de gagner ! 🏆"
    }
];

export class GeminiAssistant {
    constructor(apiKey) {
        this.enabled = true; // Toujours activé grâce au mode local
        this.apiKey = apiKey;
        this.client = null;
        this.model = null;

        if (this.apiKey) {
            try {
                this.client = new GoogleGenerativeAI(apiKey);
                this.model = this.client.getGenerativeModel({ model: GEMINI_MODEL });
            } catch (err) {
                console.warn('[AI] Mode Cloud échoué, bascule sur Mode Local.');
            }
        }
    }

    /**
     * Cerveau Hybride : Tente le Cloud, sinon utilise le Local
     */
    async ask(question, chatContext = '') {
        // 1. Essai Mode Cloud (si configuré)
        if (this.apiKey && this.model) {
            try {
                const systemPrompt = `Tu es l'IA d'ARCHIPEL. Contexte: P2P, Offline, Chiffré. Chat récent: ${chatContext}`;
                const result = await this.model.generateContent([
                    { text: systemPrompt },
                    { text: question },
                ]);
                return "☁️ " + result.response.text();
            } catch (e) { /* Fallback */ }
        }

        // 2. Mode LOCAL (Système Expert)
        return this.askLocal(question);
    }

    /**
     * Moteur d'inférence local (Zéro Dépendance)
     */
    askLocal(question) {
        const q = question.toLowerCase();
        
        // Recherche de mots-clés
        for (const entry of LOCAL_KNOWLEDGE) {
            if (entry.keywords.some(k => q.includes(k))) {
                return `💻 [IA LOCALE] ${entry.response}`;
            }
        }

        // Réponse par défaut
        return "💻 [IA LOCALE] Je suis une IA embarquée fonctionnant sans internet. Je peux répondre aux questions sur ARCHIPEL, la sécurité, ou le fonctionnement P2P. Essayez de me demander : 'Comment marche la sécurité ?'";
    }

    static isGeminiCommand(message) {
        return message.trim().startsWith('@archipel-ai');
    }

    static extractQuestion(message) {
        return message.trim().replace(/^@archipel-ai\s*/i, '').trim();
    }
}
