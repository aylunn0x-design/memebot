const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

const WALLETS_FILE = path.join(__dirname, '../../data/wallets.json');
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

let connection = new Connection(RPC_URL, 'confirmed');

// Load wallets from disk
function loadWallets() {
  if (!fs.existsSync(WALLETS_FILE)) return { trader: [], bundle: [] };
  try {
    return JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
  } catch {
    return { trader: [], bundle: [] };
  }
}

// Save wallets to disk
function saveWallets(data) {
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
}

// Generate a new Solana keypair
function generateWallet(label, type = 'trader') {
  const keypair = Keypair.generate();
  const wallet = {
    id: Date.now().toString(),
    label,
    type,
    publicKey: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    createdAt: new Date().toISOString(),
    active: true,
  };
  const data = loadWallets();
  if (type === 'bundle') {
    data.bundle.push(wallet);
  } else {
    data.trader.push(wallet);
  }
  saveWallets(data);
  // Return without private key for frontend safety
  return sanitize(wallet);
}

// Import wallet from private key
function importWallet(privateKeyB58, label, type = 'trader') {
  try {
    const secretKey = bs58.decode(privateKeyB58);
    const keypair = Keypair.fromSecretKey(secretKey);
    const wallet = {
      id: Date.now().toString(),
      label,
      type,
      publicKey: keypair.publicKey.toBase58(),
      privateKey: privateKeyB58,
      createdAt: new Date().toISOString(),
      active: true,
    };
    const data = loadWallets();
    if (type === 'bundle') {
      data.bundle.push(wallet);
    } else {
      data.trader.push(wallet);
    }
    saveWallets(data);
    return sanitize(wallet);
  } catch (e) {
    throw new Error('Invalid private key');
  }
}

// Get keypair object for signing (used internally by bots)
function getKeypair(walletId) {
  const data = loadWallets();
  const all = [...data.trader, ...data.bundle];
  const wallet = all.find(w => w.id === walletId);
  if (!wallet) throw new Error('Wallet not found');
  const secretKey = bs58.decode(wallet.privateKey);
  return Keypair.fromSecretKey(secretKey);
}

// Get all wallets (no private keys)
function getAllWallets() {
  const data = loadWallets();
  return {
    trader: data.trader.map(sanitize),
    bundle: data.bundle.map(sanitize),
  };
}

// Remove wallet by id
function removeWallet(walletId) {
  const data = loadWallets();
  data.trader = data.trader.filter(w => w.id !== walletId);
  data.bundle = data.bundle.filter(w => w.id !== walletId);
  saveWallets(data);
  return { success: true };
}

// Swap wallet label
function swapWalletLabel(walletId, newLabel) {
  const data = loadWallets();
  const all = [...data.trader, ...data.bundle];
  const wallet = all.find(w => w.id === walletId);
  if (!wallet) throw new Error('Wallet not found');
  wallet.label = newLabel;
  saveWallets(data);
  return sanitize(wallet);
}

// Get SOL balance for a wallet
async function getBalance(publicKey) {
  try {
    const pubkey = new PublicKey(publicKey);
    const lamports = await connection.getBalance(pubkey);
    return lamports / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

// Get balances for all wallets
async function getAllBalances() {
  const data = loadWallets();
  const all = [...data.trader, ...data.bundle];
  const balances = {};
  await Promise.all(all.map(async w => {
    balances[w.id] = await getBalance(w.publicKey);
  }));
  return balances;
}

// Generate bundle wallets (6 by default)
function generateBundleWallets(count = 6) {
  const data = loadWallets();
  // Clear old bundle wallets
  data.bundle = [];
  saveWallets(data);
  const created = [];
  for (let i = 1; i <= count; i++) {
    created.push(generateWallet(`Bundle W${i}`, 'bundle'));
  }
  return created;
}

// Randomize SOL amounts across bundle wallets (sum = total)
function randomizeBundleAmounts(total, count) {
  let amounts = [];
  let remaining = total;
  for (let i = 0; i < count - 1; i++) {
    const min = 0.01;
    const max = remaining - (count - i - 1) * min;
    if (max <= min) { amounts.push(min); remaining -= min; continue; }
    const val = Math.round((Math.random() * (max - min) + min) * 1000) / 1000;
    amounts.push(val);
    remaining = Math.round((remaining - val) * 1000) / 1000;
  }
  amounts.push(Math.round(remaining * 1000) / 1000);
  // Shuffle
  for (let i = amounts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [amounts[i], amounts[j]] = [amounts[j], amounts[i]];
  }
  return amounts;
}

// Strip private key for frontend
function sanitize(w) {
  const { privateKey, ...safe } = w;
  return safe;
}

module.exports = {
  generateWallet,
  importWallet,
  getKeypair,
  getAllWallets,
  removeWallet,
  swapWalletLabel,
  getBalance,
  getAllBalances,
  generateBundleWallets,
  randomizeBundleAmounts,
};