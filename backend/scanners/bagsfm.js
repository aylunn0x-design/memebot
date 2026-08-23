const axios = require('axios');

const BAGS_API = 'https://public-api-v2.bags.fm/api/v1';

let callbacks = [], running = false, pollTimer = null;
let mode = 'stopped';
let seenMints = new Set();

function onCoin(cb) { callbacks.push(cb); }
function clearCallbacks() { callbacks = []; }
function emit(coin) { callbacks.forEach(cb => cb(coin)); }

function normalize(raw) {
  const mint = raw.mint || raw.mintAddress || raw.tokenMint || raw.address || '';
  return {
    platform: 'bagsfm',
    stage: 'new',
    mintAddress: mint,
    name: raw.name || raw.tokenName || '',
    ticker: raw.symbol || raw.ticker || raw.tokenSymbol || '',
    marketCap: raw.marketCap || raw.market_cap || raw.mcap || 0,
    liquiditySOL: raw.liquiditySol || raw.liquidity || raw.liquidityInSol || 0,
    devWalletPct: raw.devWalletPct || raw.creatorHoldingPct || null,
    top10HoldersPct: raw.top10HoldersPct || null,
    twitterUrl: raw.twitter || raw.twitterUrl || '',
    websiteUrl: raw.website || raw.websiteUrl || '',
    hasTwitter: !!(raw.twitter || raw.twitterUrl),
    hasWebsite: !!(raw.website || raw.websiteUrl),
    imageUrl: raw.image || raw.imageUrl || raw.image_uri || '',
    createdAt: raw.createdAt || raw.launchedAt || raw.created_timestamp || Date.now(),
    volume5m: raw.volume5m || raw.volume || 0,
    priceUsd: raw.price || raw.priceUsd || raw.priceInUsd || 0,
    raw,
  };
}

async function pollBagsFeed() {
  if (!running) return;
  try {
    const res = await axios.get(`${BAGS_API}/get-token-launch-feed`, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' },
    });

    const body = res.data;
    let tokens = [];

    if (body && body.response) {
      tokens = Array.isArray(body.response) ? body.response : body.response.tokens || body.response.launches || [];
    } else if (Array.isArray(body)) {
      tokens = body;
    } else if (body && body.data) {
      tokens = Array.isArray(body.data) ? body.data : [];
    }

    let newCount = 0;
    for (const token of tokens.slice(0, 20)) {
      const coin = normalize(token);
      if (!coin.mintAddress || seenMints.has(coin.mintAddress)) continue;
      seenMints.add(coin.mintAddress);
      newCount++;
      emit(coin);
    }

    if (seenMints.size > 3000) {
      const arr = [...seenMints];
      seenMints = new Set(arr.slice(-1500));
    }

    if (newCount > 0) console.log(`[BagsFm] ${newCount} new tokens from feed`);
    mode = 'polling';
  } catch (e) {
    if (e.response && e.response.status === 401) {
      console.error('[BagsFm] API requires authentication — scanner unavailable without API key');
      mode = 'unavailable';
      running = false;
      return;
    }
    console.error('[BagsFm] Poll error:', e.message);
    mode = 'polling_error';
  }
  if (running) pollTimer = setTimeout(pollBagsFeed, 20000);
}

function start() {
  if (running) return;
  running = true;
  mode = 'starting';
  setTimeout(pollBagsFeed, 3000);
  console.log('[BagsFm] Scanner started — polling bags.fm API');
}

function stop() {
  running = false;
  mode = 'stopped';
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  console.log('[BagsFm] Scanner stopped');
}

function getStatus() {
  return { running, mode };
}

module.exports = { start, stop, onCoin, clearCallbacks, getStatus };
