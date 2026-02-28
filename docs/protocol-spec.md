# Protocole ARCHIPEL — Spécification Technique v1

## Format de Paquet

```
MAGIC (4 bytes)       : 0x41 0x52 0x43 0x48 ("ARCH")
TYPE  (1 byte)        : 0x01=HELLO, 0x02=PEER_LIST, 0x03=MSG,
                        0x04=CHUNK_REQ, 0x05=CHUNK_DATA,
                        0x06=MANIFEST, 0x07=ACK
NODE_ID (32 bytes)    : SHA256(publicKey Ed25519) de l'émetteur
PAYLOAD_LEN (4 bytes) : uint32 Big Endian
PAYLOAD (N bytes)     : Contenu chiffré (variable)
HMAC-SHA256 (32 bytes): Sur tout le paquet (sans HMAC lui-même)
```

## Protocole de Découverte (Sprint 1)

1. Nœud A rejoint le réseau → émet HELLO en multicast UDP
2. Nœud B reçoit HELLO → extrait ip:port de l'émetteur → ajoute dans PeerTable
3. Nœud B répond avec PEER_LIST via TCP direct
4. Si 90s sans HELLO → nœud marqué mort

## Handshake Archipel (Sprint 2)

Inspiré du Noise Protocol (XX pattern) :

```
1. Alice → Bob : { HELLO, dhPublicKey_Alice }
2. Bob → Alice : { HELLO, dhPublicKey_Bob }
3. Dérivation clé partagée : X25519(privAlice, pubBob) = X25519(privBob, pubAlice)
4. sessionKey = SHA256(sharedSecret)
5. Tous les messages suivants chiffrés avec ChaCha20-Poly1305 + nonce aléatoire
```

## Web of Trust — TOFU

- Premier contact → enregistre l'empreinte de la clé publique
- Contacts suivants → vérifie correspondance avec clé connue
- Si différent → alerte MITM potential

## Chunking (Sprint 3)

```json
{
  "file_id": "<SHA256 du fichier complet>",
  "file_name": "document.pdf",
  "file_size": 52428800,
  "chunk_size": 524288,
  "chunks": [
    { "index": 0, "hash": "<SHA256 chunk 0>" },
    { "index": 1, "hash": "<SHA256 chunk 1>" }
  ]
}
```

## Limites Connues

- Pas de NAT traversal (réseau LAN uniquement)
- Pas de persistance des messages entre sessions (en cours)
- PeerTable en mémoire uniquement (pas dans SQLite encore)
