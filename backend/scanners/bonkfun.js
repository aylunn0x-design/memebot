const WebSocket = require('ws');
const axios = require('axios');

let callbacks = [], running = false, pollTimer = null;

function onCoin(cb) { callbacks.push(cb); }
function emit(coin) { callbacks.forEach(cb => cb(coin)); }

function normalize(raw, stage) {
  return {
    platform: 'bonkfun', stage: stage || 'new',
    mintAddress: raw.mint || raw.mintAddress || raw.tokenAddress || raw.address || '',
    name: raw.name || '', ticker: raw.symbol || raw.ticker || '',
    marketCap: raw.marketCap || raw.market_cap || 0,
    liquiditySOL: raw.liquiditySol || raw.liquidity || 0,
    devWalletPct: null, top10HoldersPct: null,
    twitterUrl: raw.twitter || raw.twitterUrl || '',
    websiteUrl: raw.website || raw.websiteUrl || '',
    hasTwitter: !!(raw.twitter || raw.twitterUrl),
    hasWebsite: !!(raw.website || raw.websiteUrl),
    imageUrl: raw.image || raw.imageUrl || raw.image_uri || '',
    createdAt: raw.createdAt || raw.created_timestamp || Date.now(),
    volume5m: raw.volume5m || 0, priceUsd: raw.price || raw.priceUsd || 0, raw,
  };
}

async function poll() {
  if (!running) return;
  try {
    // letsbonk.fun uses pump.fun compatible API
    const res = await axios.get('https://client-api-2-74b1891ee9f9.herokuapp.com/coins?limit=20&sort=created_timestamp&order=DESC', { timeout: 8000 });
    const coins = Array.isArray(res.data) ? res.data : res.data?.coins || [];
    coins.slice(0, 10).forEach(c => emit(normalize(c, 'new')));
  } catch (e) { console.error('[BonkFun] Poll error:', e.message); }
  if (running) pollTimer = setTimeout(poll, 20000);
}

function start() {
  if (running) return;
  running = true;
  setTimeout(poll, 5000);
  console.log('[BonkFun] Scanner started (polling mode)');
}

function stop() {
  running = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  console.log('[BonkFun] Scanner stopped');
}

module.exports = { start, stop, onCoin };
