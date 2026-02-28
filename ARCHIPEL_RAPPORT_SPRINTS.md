# 🏆 ARCHIPEL — Rapport d'Évolution Technique
**LBS Hackathon 2026 — The Geek & The Moon**

Ce document présente l'évolution du projet ARCHIPEL, étape par étape, selon la structure des Sprints demandée par le jury.

---

## 🏗️ Sprint 0 : Fondations & Identité Cryptographique
*L'objectif était de poser les bases de la communication sécurisée et de l'identité décentralisée.*

- **Architecture Node.js** : Mise en place d'un environnement modulaire (ESM).
- **Format de Paquet `ARCH`** : Création d'un protocole binaire custom (Magic bytes, Type, NodeID, Payload Length, Payload, HMAC).
- **Identité Souveraine** : Chaque utilisateur génère sa propre identité (`Ed25519` pour la signature et `X25519` pour le chiffrement).
- **NODE_ID** : Identifiant unique calculé par `SHA-256` de la clé publique de signature.

---

## 📡 Sprint 1 : Découverte Réseau sans Internet (LAN)
*L'objectif était de permettre aux machines de se trouver automatiquement sur un réseau local.*

- **UDP Multicast** : Utilisation de l'adresse `239.255.42.99` pour le broadcast des paquets `HELLO`.
- **Peer Discovery** : Détection automatique des nouveaux nœuds sans serveur central.
- **Peer Table** : Gestion d'une table de routage locale en temps réel avec détection des nœuds inactifs (Timeout 90s).

---

## 🔒 Sprint 2 : Messagerie Chiffrée de Bout-en-Bout (E2EE)
*L'objectif était de garantir la confidentialité absolue des échanges.*

- **Handshake X25519** : Échange de clés éphémères inspiré du Noise Protocol (Pattern XX).
- **Chiffrement AES-256-GCM** : Cryptage des messages avec authentification (Auth Tag) pour empêcher toute modification.
- **CLI Interactive** : Interface ligne de commande interactive avec `chalk` (couleurs) et `readline`.

---

## 📦 Sprint 3 : Transfert de Fichiers P2P (Chunking)
*L'objectif était de permettre le partage de fichiers lourds de manière distribuée.*

- **Chunking Tool** : Découpage intelligent des fichiers en morceaux de 512 ko avec hachage individuel.
- **Manifests JSON** : Descriptif complet du fichier (ID, taille, hashes des morceaux) partagé via le réseau.
- **Téléchargement TCP** : Récupération des données via flux TCP directs et reconstruction automatique du fichier à l'arrivée.

---

## 🚀 Sprint 4 : Robustesse, Persistence & Relais
*L'objectif était de rendre le système résistant et complet pour une utilisation réelle.*

- **Persistance SQLite (`sql.js`)** : Sauvegarde locale de l'historique des messages et des pairs de confiance (Web of Trust) dans `archipel.db`.
- **Relais de Messages (Store & Forward)** : Capacité de mettre un message en file d'attente si le destinataire est hors-ligne, pour lui remettre via un autre pair.
- **Signatures Ed25519** : Signature numérique de chaque paquet `MSG` pour garantir l'identité de l'émetteur et empêcher l'usurpation.
- **Intégration Gemini AI** : Module `@archipel-ai` pour assister les utilisateurs (nécessite une clé API).

---

## 🌐 Sprint 5 : Interface Web, Multimedia & Finalisation
*L'objectif était d'humaniser le protocole avec une interface moderne et des fonctionnalités riches.*

- **Interface Web Moderne** : Utilisation d'Express et Socket.io pour une interface temps réel intuitive, accessible via navigateur (port 3000).
- **Messages Vocaux P2P** : Enregistrement et transmission de messages audio `.webm` chiffrés de bout-en-bout, offrant une alternative rapide au texte.
- **Topologie Réseau Intégrée** : Visualisation dynamique (Canvas) des pairs connectés directement dans le navigateur, sans serveur central.
- **Durcissement "Zéro-Internet"** : Retrait de toutes les dépendances CDN externes. Toutes les bibliothèques sont servies localement pour garantir un fonctionnement total hors-ligne.

---

### 📝 Conclusion Technique
ARCHIPEL est passé d'un simple concept de paquet binaire (Sprint 0) à un **système de communication P2P complet, chiffré, persistant et capable de transférer des fichiers en réseau retardé** (Sprint 4), le tout couronné par une **expérience utilisateur moderne et multimédia** (Sprint 5). Pour la mission survie, ARCHIPEL est prêt.
