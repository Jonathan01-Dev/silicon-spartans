/**
 * ARCHIPEL — Module Cryptographique : Identité
 * Utilise le module crypto NATIF de Node.js 22 (pas de lib externe)
 * Ed25519 pour la signature/identité
 * X25519 pour l'échange de clé Diffie-Hellman
 * NODE_ID = SHA256(publicKey Ed25519)
 */

import { generateKeyPairSync, createHash, createSign, createVerify, createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_FILE = path.join(__dirname, '../../.keys.json');

/**
 * Génère une nouvelle paire de clés Ed25519 + X25519
 */
export function generateIdentity() {
  // Clés Ed25519 pour signature / identité
  const signingKeyPair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // Clés X25519 pour l'échange Diffie-Hellman
  const dhKeyPair = generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // NODE_ID = SHA256(clé publique Ed25519)
  const nodeId = createHash('sha256')
    .update(signingKeyPair.publicKey)
    .digest('hex');

  return {
    nodeId,
    signing: {
      publicKey: signingKeyPair.publicKey.toString('hex'),
      privateKey: signingKeyPair.privateKey.toString('hex'),
    },
    dh: {
      publicKey: dhKeyPair.publicKey.toString('hex'),
      privateKey: dhKeyPair.privateKey.toString('hex'),
    },
  };
}

/**
 * Sauvegarde l'identité dans un fichier local
 */
export function saveIdentity(identity) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(identity, null, 2));
}

/**
 * Charge ou génère une identité persistante
 */
export function loadOrCreateIdentity() {
  if (fs.existsSync(KEYS_FILE)) {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
  }
  const identity = generateIdentity();
  saveIdentity(identity);
  return identity;
}

/**
 * Signe un message avec la clé privée Ed25519
 */
export function signMessage(message, privateKeyHex) {
  const privKeyDer = Buffer.from(privateKeyHex, 'hex');
  const privateKey = { key: privKeyDer, format: 'der', type: 'pkcs8' };
  const signer = createSign('SHA256');
  const msgBytes = typeof message === 'string' ? Buffer.from(message) : message;
  signer.update(msgBytes);
  return signer.sign(privateKey).toString('hex');
}

/**
 * Vérifie la signature Ed25519
 */
export function verifySignature(signatureHex, message, publicKeyHex) {
  try {
    const pubKeyDer = Buffer.from(publicKeyHex, 'hex');
    const publicKey = { key: pubKeyDer, format: 'der', type: 'spki' };
    const verifier = createVerify('SHA256');
    const msgBytes = typeof message === 'string' ? Buffer.from(message) : message;
    verifier.update(msgBytes);
    return verifier.verify(publicKey, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Calcule le HMAC-SHA256 d'un payload (retourne un Buffer)
 */
export function computeHMAC(payload, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  return createHmac('sha256', key).update(payload).digest();
}

/**
 * Vérifie un HMAC-SHA256 de façon constante (protection timing attack)
 */
export function verifyHMAC(payload, macBuf, keyHex) {
  const expected = computeHMAC(payload, keyHex);
  if (macBuf.length !== expected.length) return false;
  return timingSafeEqual(macBuf, expected);
}
