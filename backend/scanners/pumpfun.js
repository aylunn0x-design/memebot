const WebSocket = require('ws');
const axios = require('axios');

let ws = null;
let callbacks = [];
let reconnectTimer = null;
let running = false;
let mode = 'stopped';

function clearCallbacks() { callbacks = []; }
function getStatus() { return { running, mode }; }

const PUMP_WS = 'wss://pumpportal.fun/api/data';

function onCoin(cb) { callbacks.push(cb); }
function emit(coin) { callbacks.forEach(cb => cb(coin)); }

function normalize(raw, stage) {
  return {
    platform: 'pumpfun', stage: stage || 'new',
    mintAddress: raw.mint || raw.mintAddress || '',
    name: raw.name || '', ticker: raw.symbol || raw.ticker || '',
    marketCap: raw.marketCapSol || 0, liquiditySOL: raw.vSolInBondingCurve || 0,
    devWalletPct: raw.devWalletPct || null, top10HoldersPct: raw.top10HoldersPct || null,
    twitterUrl: raw.twitter || '', websiteUrl: raw.website || '',
    hasTwitter: !!(raw.twitter), hasWebsite: !!(raw.website),
    imageUrl: raw.image || raw.imageUri || '',
    createdAt: raw.timestamp || Date.now(),
    volume5m: raw.volume5m || 0, priceUsd: raw.priceUsd || 0, raw,
  };
}

function connect() {
  if (!running) return;
  console.log('[PumpFun] Connecting...');
  ws = new WebSocket(PUMP_WS);
  ws.on('open', () => {
    console.log('[PumpFun] Connected');
    mode = 'websocket';
    ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    ws.send(JSON.stringify({ method: 'subscribeMigration' }));
  });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.txType === 'create' || msg.method === 'newToken') emit(normalize(msg, 'new'));
      else if (msg.txType === 'migrate' || msg.method === 'migration') emit(normalize(msg, 'migrated'));
    } catch {}
  });
  ws.on('error', (e) => console.error('[PumpFun] WS error:', e.message));
  ws.on('close', () => {
    console.log('[PumpFun] Disconnected — reconnecting in 3s...');
    if (running) reconnectTimer = setTimeout(connect, 3000);
  });
}

async function pollFinalStretch() {
  if (!running) return;
  try {
    const res = await axios.get('https://client-api-2-74b1891ee9f9.herokuapp.com/coins?limit=20&sort=last_trade_timestamp&order=DESC&includeNsfw=false', { timeout: 8000 });
    const coins = Array.isArray(res.data) ? res.data : res.data.coins || [];
    coins.filter(c => c.bonding_curve_percentage >= 80 && c.bonding_curve_percentage < 100)
      .forEach(c => emit(normalize({ mint: c.mint, name: c.name, symbol: c.symbol, twitter: c.twitter, website: c.website, image: c.image_uri, vSolInBondingCurve: c.virtual_sol_reserves / 1e9, marketCapSol: c.market_cap, timestamp: c.last_trade_timestamp }, 'finalstretch')));
  } catch (e) { console.error('[PumpFun] Poll error:', e.message); }
  if (running) setTimeout(pollFinalStretch, 15000);
}

function start() {
  if (running) return;
  running = true;
  mode = 'starting';
  connect();
  setTimeout(pollFinalStretch, 5000);
  console.log('[PumpFun] Scanner started');
}

function stop() {
  running = false;
  mode = 'stopped';
  if (ws) { ws.close(); ws = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  console.log('[PumpFun] Scanner stopped');
}

module.exports = { start, stop, onCoin, clearCallbacks, getStatus };
