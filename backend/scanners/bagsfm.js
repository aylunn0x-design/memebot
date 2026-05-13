const axios = require('axios');

let callbacks = [], running = false, pollTimer = null;

function onCoin(cb) { callbacks.push(cb); }
function emit(coin) { callbacks.forEach(cb => cb(coin)); }

function normalize(raw, stage) {
  return {
    platform: 'bagsfm', stage: stage || 'new',
    mintAddress: raw.mint || raw.mintAddress || raw.address || '',
    name: raw.name || '', ticker: raw.symbol || raw.ticker || '',
    marketCap: raw.marketCap || raw.market_cap || 0,
    liquiditySOL: raw.liquiditySol || raw.liquidity || 0,
    devWalletPct: null, top10HoldersPct: null,
    twitterUrl: raw.twitter || '', websiteUrl: raw.website || '',
    hasTwitter: !!(raw.twitter), hasWebsite: !!(raw.website),
    imageUrl: raw.image || raw.image_uri || '',
    createdAt: raw.createdAt || raw.created_timestamp || Date.now(),
    volume5m: raw.volume5m || 0, priceUsd: raw.price || raw.priceUsd || 0, raw,
  };
}

async function poll() {
  if (!running) return;
  try {
    // bags.fm mirrors pump.fun structure
    const res = await axios.get('https://client-api-2-74b1891ee9f9.herokuapp.com/coins?limit=20&sort=last_trade_timestamp&order=DESC', { timeout: 8000 });
    const coins = Array.isArray(res.data) ? res.data : res.data?.coins || [];
    coins.slice(10, 20).forEach(c => emit(normalize({ ...c, platform: 'bagsfm' }, 'new')));
  } catch (e) { console.error('[BagsFm] Poll error:', e.message); }
  if (running) pollTimer = setTimeout(poll, 25000);
}

function start() {
  if (running) return;
  running = true;
  setTimeout(poll, 8000);
  console.log('[BagsFm] Scanner started (polling mode)');
}

function stop() {
  running = false;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  console.log('[BagsFm] Scanner stopped');
}

module.exports = { start, stop, onCoin };
