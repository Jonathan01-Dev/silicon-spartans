# 📖 Guide de Déploiement & Tests — ARCHIPEL

Ce guide explique comment envoyer votre projet sur GitHub, l'installer sur une autre machine et tester l'ensemble des fonctionnalités (Audio, Fichiers, GPS).

---

## 📤 1. Envoyer sur GitHub
Depuis le terminal dans le dossier `ARCHIPEL` :

```powershell
# 1. Ajouter tous les fichiers modifiés
git add .

# 2. Créer le commit final
git commit -m "ARCHIPEL Ultimate Platinum Edition — Hackathon 2026"

# 3. Pousser vers votre dépôt (remplacez 'main' par votre branche si besoin)
git push origin main
```

---

## 📥 2. Installer sur le 2ème PC
Sur l'autre machine connectée au **même réseau WiFi/LAN** :

1. **Récupérer le code :**
   ```powershell
   git clone https://github.com/LUC-cmd/ARCHIPEL.git
   cd ARCHIPEL
   ```

2. **Installer les dépendances :**
   ```powershell
   npm install
   ```

3. **Lancer l'application :**
   ```powershell
   npm run start-ui
   ```

---

## 🛡️ 3. Configuration Spécifique (AUDIO & GPS)
**IMPORTANT :** Les navigateurs bloquent le micro et le GPS sur les connexions non-HTTPS.
Sur le **2ème PC**, vous devez autoriser l'adresse du serveur :

1. Dans Chrome/Edge, allez à : `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Mettez sur **Enabled**.
3. Dans la zone de texte, ajoutez l'adresse IP du 1er PC : `http://192.168.x.x:3000`
4. Cliquez sur **Relaunch**.

---

## 🧪 4. Protocole de Test

### Étape 1 : Découverte
* Ouvrez `http://localhost:3000` sur le PC 1.
* Ouvrez `http://[IP_DU_PC_1]:3000` sur le PC 2.
* Le PC 1 doit apparaître dans la liste à gauche du PC 2 (et inversement).
* *Si ça n'apparaît pas :* Utilisez la zone "IP MANUELLE" en bas à gauche pour forcer la connexion.

### Étape 2 : Chat Chiffré
* Cliquez sur le nom du pair.
* Envoyez un message.
* Vous devriez voir "Session E2E établie" dans le terminal. Le badge "Chiffré" apparaît sur l'interface.

### Étape 3 : Audio & GPS
* **Audio :** Maintenez le bouton micro, parlez, puis relâchez. Le destinataire doit voir un bouton "ÉCOUTER LE VOCAL".
* **GPS :** Cliquez sur l'icône de position. Un lien Google Maps chiffré doit être envoyé.

### Étape 4 : Transfert de Fichiers (Chunking)
* Envoyez un fichier via le bouton trombone.
* Sur l'autre PC, allez dans la section "FICHIERS P2P" (en bas à gauche).
* Cliquez sur "Télécharger". Vous verrez la barre de progression des chunks.

---
**ARCHIPEL est prêt pour la démonstration. Bonne chance pour le jury !**
