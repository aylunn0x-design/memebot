const fs = require('fs');
const path = require('path');
const walletManager = require('../wallets/manager');

const DEPLOY_LOG_FILE = path.join(__dirname, '../../data/deploy_log.json');

let deployerState = {
  running: false,
  bundleSol: 10,
  bundleWalletCount: 6,
  bundleSupplyPct: 20,
  deployLog: [],
};

function loadDeployLog() {
  if (fs.existsSync(DEPLOY_LOG_FILE)) {
    try { deployerState.deployLog = JSON.parse(fs.readFileSync(DEPLOY_LOG_FILE, 'utf8')); } catch {}
  }
}

function saveDeployLog() {
  fs.writeFileSync(DEPLOY_LOG_FILE, JSON.stringify(deployerState.deployLog, null, 2));
}

function buildMetadata(signal) {
  const { classification } = signal;
  return {
    name: classification.suggested_name || 'MemeToken',
    symbol: classification.suggested_ticker || 'MEME',
    description: `Inspired by: "${signal.text.slice(0, 100)}" — @${signal.username}`,
    twitter: `https://x.com/${signal.username}`,
    website: '',
    platform: classification.platform,
  };
}

async function simulateDeploy(signal, config) {
  console.log(`[Deployer] SIMULATING deploy of $${signal.classification.suggested_ticker}`);
  await new Promise(r => setTimeout(r, 800));
  const platform = signal.classification.platform;
  const amounts = walletManager.randomizeBundleAmounts(config.bundleSol, config.bundleWalletCount);
  const entry = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    simulated: true,
    token: {
      name: signal.classification.suggested_name,
      ticker: signal.classification.suggested_ticker,
      platform,
    },
    tweet: { text: signal.text, username: signal.username, url: signal.url },
    bundle: { totalSol: config.bundleSol, walletCount: config.bundleWalletCount, supplyPct: config.bundleSupplyPct, amounts },
    mintAddress: 'SIM_' + Math.random().toString(36).slice(2, 12).toUpperCase(),
    txSignature: 'SIM_TX_' + Math.random().toString(36).slice(2, 20),
    status: 'simulated',
  };
  deployerState.deployLog.unshift(entry);
  if (deployerState.deployLog.length > 200) deployerState.deployLog.pop();
  saveDeployLog();
  console.log(`[Deployer] SIM deploy complete: $${entry.token.ticker} on ${platform}`);
  return entry;
}

async function deploy(signal, liveMode = false) {
  const config = {
    bundleSol: deployerState.bundleSol,
    bundleWalletCount: deployerState.bundleWalletCount,
    bundleSupplyPct: deployerState.bundleSupplyPct,
  };
  if (!liveMode) return await simulateDeploy(signal, config);
  // TODO: Real deployment requires Metaplex metadata upload, bonding curve
  // interaction, bundled buys via Jito, and proper error handling/rollback.
  // NEVER enable live mode until WR > 60% over 200+ trades.
  console.log('[Deployer] WARNING: Live deploy not implemented — falling through to simulation');
  return await simulateDeploy(signal, config);
}

function updateConfig(cfg) {
  if (cfg.bundleSol !== undefined) deployerState.bundleSol = parseFloat(cfg.bundleSol);
  if (cfg.bundleWalletCount !== undefined) deployerState.bundleWalletCount = parseInt(cfg.bundleWalletCount);
  if (cfg.bundleSupplyPct !== undefined) deployerState.bundleSupplyPct = parseInt(cfg.bundleSupplyPct);
  return getStatus();
}

function getStatus() {
  return {
    running: deployerState.running,
    bundleSol: deployerState.bundleSol,
    bundleWalletCount: deployerState.bundleWalletCount,
    bundleSupplyPct: deployerState.bundleSupplyPct,
    deployLog: deployerState.deployLog.slice(0, 50),
  };
}

loadDeployLog();
module.exports = { deploy, updateConfig, getStatus };
