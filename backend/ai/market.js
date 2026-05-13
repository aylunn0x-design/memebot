const axios = require('axios');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../data/market_state.json');

let marketState = {
  solPrice: 0,
  solPriceChange24h: 0,
  totalVolume24h: 0,
  mode: 'normal',
  lastUpdated: null,
  history: [],
};

const MODES = {
  aggressive: {
    minScoreThreshold: 65,
    maxPositionSol: 2.0,
    positionMultiplier: 1.5,
    description: 'High volume, stable price — entering aggressively',
  },
  normal: {
    minScoreThreshold: 70,
    maxPositionSol: 1.0,
    positionMultiplier: 1.0,
    description: 'Normal market conditions',
  },
  conservative: {
    minScoreThreshold: 80,
    maxPositionSol: 0.5,
    positionMultiplier: 0.6,
    description: 'Low volume or dropping price — smaller positions',
  },
  paused: {
    minScoreThreshold: 100,
    maxPositionSol: 0,
    positionMultiplier: 0,
    description: 'Extreme conditions — trading paused',
  },
};

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try { marketState = { ...marketState, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; }
    catch {}
  }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(marketState, null, 2));
}

async function fetchSolPrice() {
  try {
    const res = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true',
      { timeout: 8000 }
    );
    const data = res.data?.solana;
    if (!data) return null;
    return { price: data.usd, change24h: data.usd_24h_change, volume24h: data.usd_24h_vol };
  } catch (e) {
    console.error('[Market] Price fetch failed:', e.message);
    return null;
  }
}

function determineMode(price, change24h, volume24h) {
  if (change24h < -20) return 'paused';
  if (change24h < -8 || volume24h < 1_000_000_000) return 'conservative';
  if (change24h > 5 && volume24h > 5_000_000_000) return 'aggressive';
  return 'normal';
}

async function update() {
  const priceData = await fetchSolPrice();
  if (!priceData) return marketState;

  const prevMode = marketState.mode;
  marketState.solPrice = priceData.price;
  marketState.solPriceChange24h = priceData.change24h;
  marketState.totalVolume24h = priceData.volume24h;
  marketState.mode = determineMode(priceData.price, priceData.change24h, priceData.volume24h);
  marketState.lastUpdated = new Date().toISOString();

  marketState.history.push({ price: priceData.price, time: marketState.lastUpdated });
  if (marketState.history.length > 24) marketState.history.shift();

  if (prevMode !== marketState.mode) {
    console.log(`[Market] Mode changed: ${prevMode} → ${marketState.mode}`);
  }

  saveState();
  return marketState;
}

function getModeConfig() {
  return { ...MODES[marketState.mode], mode: marketState.mode, solPrice: marketState.solPrice, solPriceChange24h: marketState.solPriceChange24h };
}

function getPositionSize(basePositionSol, coinScore) {
  const config = getModeConfig();
  if (config.positionMultiplier === 0) return 0;
  const scoreMultiplier = 1 + ((coinScore - 70) / 100);
  const adjusted = basePositionSol * config.positionMultiplier * Math.max(0.5, scoreMultiplier);
  return Math.min(adjusted, config.maxPositionSol);
}

function getState() {
  return { ...marketState, modeConfig: getModeConfig(), allModes: MODES };
}

let updateTimer = null;

function startAutoUpdate() {
  update();
  updateTimer = setInterval(update, 5 * 60 * 1000);
}

function stopAutoUpdate() {
  if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
}

loadState();

module.exports = { update, getModeConfig, getPositionSize, getState, startAutoUpdate, stopAutoUpdate };
