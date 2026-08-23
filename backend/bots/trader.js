const axios = require('axios');
const { Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const walletManager = require('../wallets/manager');
const { scoreCoin } = require('../ai/classifier');
const { quickSimCheck } = require('../safety/checks');
const { getModeConfig, getPositionSize } = require('../ai/market');
const { logOutcome } = require('../ai/trainer');
const pumpScanner = require('../scanners/pumpfun');
const bonkScanner = require('../scanners/bonkfun');
const bagsScanner = require('../scanners/bagsfm');

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');
const TRADES_FILE = path.join(__dirname, '../../data/trades.json');
const ALLOWED_PLATFORMS = ['pumpfun', 'bonkfun', 'bagsfm'];

let traderState = {
  running: false,
  liveMode: false,
  scoreThreshold: 70,
  stopLossPct: 20,
  takeProfitPct: 100,
  maxPositionSol: 1.0,
  wallets: [],
  trades: [],
  seenCoins: new Set(),
  processing: new Set(),
};

let recentFeed = [];
let pendingExits = new Map();
let lastDexRequest = 0;
const DEX_MIN_INTERVAL_MS = 600;

function loadTrades() {
  if (fs.existsSync(TRADES_FILE)) {
    try { traderState.trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8')); } catch {}
  }
}

function saveTrades() {
  fs.writeFileSync(TRADES_FILE, JSON.stringify(traderState.trades.slice(0, 500), null, 2));
}

function initWallets() {
  const allWallets = walletManager.getAllWallets();
  traderState.wallets = allWallets.trader.map(w => ({
    id: w.id, label: w.label, publicKey: w.publicKey,
    simBalance: 10, simPnl: 0, wins: 0, losses: 0,
    openPositions: [], active: true,
  }));
  console.log(`[Trader] Initialized ${traderState.wallets.length} wallets`);
}

function staggerDelay(i) {
  return new Promise(r => setTimeout(r, i * (1000 + Math.random() * 2000)));
}

async function throttledDexFetch(mintAddress) {
  const now = Date.now();
  const wait = Math.max(0, DEX_MIN_INTERVAL_MS - (now - lastDexRequest));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastDexRequest = Date.now();

  const res = await axios.get(
    `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
    { timeout: 8000 }
  );
  const pairs = res.data?.pairs;
  if (!pairs || pairs.length === 0) return null;
  const pair = pairs[0];
  return {
    priceUsd: parseFloat(pair.priceUsd) || 0,
    marketCap: pair.marketCap || pair.fdv || 0,
    liquidity: pair.liquidity?.usd || 0,
  };
}

async function handleCoin(coin) {
  if (!ALLOWED_PLATFORMS.includes(coin.platform)) return;
  const key = `${coin.platform}_${coin.mintAddress}`;
  if (traderState.seenCoins.has(key) || traderState.processing.has(key)) return;
  traderState.seenCoins.add(key);
  if (traderState.seenCoins.size > 5000) {
    const arr = [...traderState.seenCoins];
    traderState.seenCoins = new Set(arr.slice(-2000));
  }
  if (!traderState.running) return;
  traderState.processing.add(key);
  try {
    const marketConfig = getModeConfig();
    const solPrice = marketConfig.solPrice || 0;

    const safetyResult = quickSimCheck(coin, solPrice);
    if (!safetyResult.passed) {
      addFeedEntry(coin, null, 'rejected_safety', safetyResult.reasons);
      return;
    }

    if (marketConfig.mode === 'paused') return;

    const scoreResult = await scoreCoin({
      ...coin,
      solTrend: marketConfig.solPriceChange24h > 0 ? 'up' : 'down',
      marketVolume: marketConfig.mode,
    });
    const effectiveThreshold = Math.max(traderState.scoreThreshold, marketConfig.minScoreThreshold);

    console.log(`[Trader] ${coin.platform} $${coin.ticker} — Score: ${scoreResult.score} | Threshold: ${effectiveThreshold}`);

    if (!scoreResult.buy || scoreResult.score < effectiveThreshold) {
      addFeedEntry(coin, scoreResult.score, 'rejected_score', [scoreResult.reason]);
      return;
    }

    const positionSol = getPositionSize(scoreResult.suggested_position_sol || 0.5, scoreResult.score);
    if (positionSol <= 0) return;

    addFeedEntry(coin, scoreResult.score, 'buy', []);

    console.log(`[Trader] 🎯 Buying $${coin.ticker} — ${positionSol.toFixed(3)} SOL`);
    const activeWallets = traderState.wallets.filter(w => w.active).slice(0, 5);
    for (let i = 0; i < activeWallets.length; i++) {
      await staggerDelay(i);
      executeSimBuy(activeWallets[i], coin, positionSol, scoreResult);
    }
  } catch (e) {
    console.error(`[Trader] Error:`, e.message);
  } finally {
    traderState.processing.delete(key);
  }
}

function addFeedEntry(coin, aiScore, action, reasons) {
  recentFeed.unshift({
    timestamp: Date.now(),
    ticker: coin.ticker,
    name: coin.name,
    platform: coin.platform,
    stage: coin.stage,
    mintAddress: coin.mintAddress,
    aiScore,
    action,
    reasons: reasons || [],
  });
  if (recentFeed.length > 50) recentFeed.pop();
}

function executeSimBuy(wallet, coin, positionSol, scoreResult) {
  if (wallet.simBalance < positionSol) return;
  const position = {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    mintAddress: coin.mintAddress,
    platform: coin.platform,
    ticker: coin.ticker,
    name: coin.name,
    stage: coin.stage,
    entryPrice: coin.priceUsd || 0.000001,
    entryMcap: coin.marketCap || 0,
    entryTime: Date.now(),
    positionSol,
    aiScore: scoreResult.score,
    simulated: true,
    walletId: wallet.id,
    walletLabel: wallet.label,
  };
  wallet.simBalance -= positionSol;
  wallet.openPositions.push(position);
  console.log(`[Trader] SIM BUY: ${wallet.label} → $${coin.ticker} — ${positionSol.toFixed(3)} SOL`);
  scheduleRealPriceExit(wallet, position);
}

function scheduleRealPriceExit(wallet, position) {
  const maxHoldMs = 15 * 60 * 1000;
  const checkIntervalMs = 30000;
  let checks = 0;
  const maxChecks = Math.ceil(maxHoldMs / checkIntervalMs);

  const timer = setInterval(async () => {
    checks++;
    if (!wallet.openPositions.find(p => p.id === position.id)) {
      clearInterval(timer);
      pendingExits.delete(position.id);
      return;
    }

    try {
      const priceData = await throttledDexFetch(position.mintAddress);

      if (priceData && priceData.priceUsd > 0) {
        const ratio = priceData.priceUsd / position.entryPrice;
        const slRatio = 1 - (traderState.stopLossPct / 100);
        const tpRatio = 1 + (traderState.takeProfitPct / 100);

        if (ratio <= slRatio) {
          closeTrade(wallet, position, priceData.priceUsd, priceData.marketCap, 'stop_loss');
          clearInterval(timer);
          pendingExits.delete(position.id);
          return;
        }
        if (ratio >= tpRatio) {
          closeTrade(wallet, position, priceData.priceUsd, priceData.marketCap, 'take_profit');
          clearInterval(timer);
          pendingExits.delete(position.id);
          return;
        }
        if (checks >= maxChecks) {
          closeTrade(wallet, position, priceData.priceUsd, priceData.marketCap, 'max_hold');
          clearInterval(timer);
          pendingExits.delete(position.id);
          return;
        }
      } else if (checks >= maxChecks) {
        closeTrade(wallet, position, position.entryPrice, position.entryMcap, 'price_unavailable');
        clearInterval(timer);
        pendingExits.delete(position.id);
        return;
      }
    } catch (e) {
      if (checks >= maxChecks) {
        closeTrade(wallet, position, position.entryPrice, position.entryMcap, 'price_unavailable');
        clearInterval(timer);
        pendingExits.delete(position.id);
      }
    }
  }, checkIntervalMs);

  pendingExits.set(position.id, timer);
}

function closeTrade(wallet, position, exitPrice, exitMcap, exitReason) {
  const multiplier = exitPrice / position.entryPrice;
  const exitValue = position.positionSol * multiplier;
  const pnlSol = exitValue - position.positionSol;
  const holdTimeSeconds = Math.round((Date.now() - position.entryTime) / 1000);

  wallet.simBalance += exitValue;
  wallet.simPnl += pnlSol;
  if (pnlSol > 0) wallet.wins++; else wallet.losses++;
  wallet.openPositions = wallet.openPositions.filter(p => p.id !== position.id);

  const trade = {
    id: position.id,
    timestamp: new Date().toISOString(),
    platform: position.platform,
    ticker: position.ticker,
    name: position.name,
    stage: position.stage,
    walletId: wallet.id,
    walletLabel: wallet.label,
    entryPrice: position.entryPrice,
    exitPrice,
    positionSol: position.positionSol,
    exitValue,
    pnlSol: Math.round(pnlSol * 10000) / 10000,
    pnlPct: Math.round((multiplier - 1) * 10000) / 100,
    holdTimeSeconds,
    aiScore: position.aiScore,
    result: pnlSol > 0 ? 'win' : 'loss',
    exitReason,
    simulated: true,
    mintAddress: position.mintAddress,
    entryMcap: position.entryMcap,
    exitMcap: exitMcap || 0,
    priceDataUnavailable: exitReason === 'price_unavailable',
  };

  traderState.trades.unshift(trade);
  if (traderState.trades.length > 500) traderState.trades.pop();
  saveTrades();

  logOutcome({
    id: trade.id,
    coinData: { platform: position.platform, stage: position.stage },
    aiScore: position.aiScore,
    entryPrice: position.entryPrice,
    exitPrice,
    pnlSol: trade.pnlSol,
    holdTimeSeconds,
    platform: position.platform,
    stage: position.stage,
    features: {
      social_legitimacy: 50,
      stage_new: position.stage === 'new' ? 100 : 0,
      stage_finalstretch: position.stage === 'finalstretch' ? 100 : 0,
      stage_migrated: position.stage === 'migrated' ? 100 : 0,
    },
  });

  const icon = pnlSol > 0 ? '✅' : '❌';
  console.log(`[Trader] ${icon} ${wallet.label} $${position.ticker} — ${pnlSol > 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${trade.pnlPct}%) [${exitReason}]`);
}

function start() {
  if (traderState.running) return { success: false, error: 'Already running' };
  initWallets();
  if (!traderState.wallets.length) return { success: false, error: 'No trader wallets found. Generate wallets first.' };
  traderState.running = true;
  traderState.seenCoins.clear();
  pumpScanner.start();
  bonkScanner.start();
  bagsScanner.start();
  console.log('[Trader] Started — scanning pump.fun, bonk.fun, bags.fm');
  return { success: true };
}

function stop() {
  traderState.running = false;
  pumpScanner.stop();
  bonkScanner.stop();
  bagsScanner.stop();
  for (const [id, timer] of pendingExits) {
    clearInterval(timer);
  }
  pendingExits.clear();
  console.log('[Trader] Stopped');
  return { success: true };
}

function updateConfig(cfg) {
  if (cfg.scoreThreshold !== undefined) traderState.scoreThreshold = parseInt(cfg.scoreThreshold);
  if (cfg.stopLossPct !== undefined) traderState.stopLossPct = parseFloat(cfg.stopLossPct);
  if (cfg.takeProfitPct !== undefined) traderState.takeProfitPct = parseFloat(cfg.takeProfitPct);
  if (cfg.maxPositionSol !== undefined) traderState.maxPositionSol = parseFloat(cfg.maxPositionSol);
  if (cfg.liveMode !== undefined) traderState.liveMode = cfg.liveMode;
  return getStatus();
}

function getStatus() {
  const totalTrades = traderState.trades.length;
  const wins = traderState.trades.filter(t => t.result === 'win').length;
  const totalPnl = traderState.trades.reduce((a, t) => a + (t.pnlSol || 0), 0);
  return {
    running: traderState.running, liveMode: traderState.liveMode,
    scoreThreshold: traderState.scoreThreshold, stopLossPct: traderState.stopLossPct,
    takeProfitPct: traderState.takeProfitPct, totalTrades,
    winRate: totalTrades > 0 ? Math.round(wins / totalTrades * 1000) / 10 : 0,
    totalPnlSol: Math.round(totalPnl * 10000) / 10000,
    wallets: traderState.wallets.map(w => ({
      id: w.id, label: w.label, publicKey: w.publicKey,
      simBalance: Math.round(w.simBalance * 10000) / 10000,
      simPnl: Math.round(w.simPnl * 10000) / 10000,
      wins: w.wins, losses: w.losses,
      winRate: (w.wins + w.losses) > 0 ? Math.round(w.wins / (w.wins + w.losses) * 1000) / 10 : 0,
      openPositions: w.openPositions.length, active: w.active,
    })),
    recentTrades: traderState.trades.slice(0, 50),
  };
}

function getFeed() {
  return recentFeed.slice(0, 20);
}

loadTrades();

// Register callbacks ONCE at module load — never inside start()
let callbacksRegistered = false;
if (!callbacksRegistered) {
  pumpScanner.onCoin(handleCoin);
  bonkScanner.onCoin(handleCoin);
  bagsScanner.onCoin(handleCoin);
  callbacksRegistered = true;
}

module.exports = { start, stop, updateConfig, getStatus, getFeed };
