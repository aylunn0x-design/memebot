const WebSocket = require('ws');
const { Connection, PublicKey } = require('@solana/web3.js');
const axios = require('axios');

const LETSBONK_PROGRAM = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';

let callbacks = [], running = false;
let ws = null, reconnectTimer = null, pollTimer = null;
let mode = 'stopped';
let seenSigs = new Set();

function onCoin(cb) { callbacks.push(cb); }
function clearCallbacks() { callbacks = []; }
function emit(coin) { callbacks.forEach(cb => cb(coin)); }

function normalize(raw, stage) {
  return {
    platform: 'bonkfun',
    stage: stage || 'new',
    mintAddress: raw.mint || raw.mintAddress || raw.tokenAddress || raw.address || '',
    name: raw.name || '',
    ticker: raw.symbol || raw.ticker || '',
    marketCap: raw.marketCap || raw.market_cap || 0,
    liquiditySOL: raw.liquiditySol || raw.liquidity || 0,
    devWalletPct: raw.devWalletPct || null,
    top10HoldersPct: raw.top10HoldersPct || null,
    twitterUrl: raw.twitter || raw.twitterUrl || '',
    websiteUrl: raw.website || raw.websiteUrl || '',
    hasTwitter: !!(raw.twitter || raw.twitterUrl),
    hasWebsite: !!(raw.website || raw.websiteUrl),
    imageUrl: raw.image || raw.imageUrl || raw.image_uri || '',
    createdAt: raw.createdAt || raw.created_timestamp || Date.now(),
    volume5m: raw.volume5m || 0,
    priceUsd: raw.price || raw.priceUsd || 0,
    raw,
  };
}

function getRpcWsUrl() {
  const rpc = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
  return rpc.replace('https://', 'wss://').replace('http://', 'ws://');
}

function connectLogsSubscribe() {
  if (!running) return;
  const wsUrl = getRpcWsUrl();
  console.log(`[BonkFun] Connecting to RPC WebSocket for logsSubscribe...`);

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    console.error('[BonkFun] WebSocket creation failed:', e.message);
    fallbackToPolling();
    return;
  }

  ws.on('open', () => {
    console.log('[BonkFun] RPC WebSocket connected — subscribing to LetsBonk program logs');
    mode = 'websocket';
    const subscribeMsg = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: [LETSBONK_PROGRAM] },
        { commitment: 'confirmed' },
      ],
    };
    ws.send(JSON.stringify(subscribeMsg));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'logsNotification' && msg.params && msg.params.result) {
        handleLogNotification(msg.params.result);
      }
    } catch {}
  });

  ws.on('error', (e) => {
    console.error('[BonkFun] WS error:', e.message);
  });

  ws.on('close', () => {
    console.log('[BonkFun] RPC WebSocket disconnected');
    if (running) {
      console.log('[BonkFun] Reconnecting in 5s...');
      reconnectTimer = setTimeout(connectLogsSubscribe, 5000);
    }
  });
}

function handleLogNotification(result) {
  const { value } = result;
  if (!value || value.err) return;

  const sig = value.signature;
  if (seenSigs.has(sig)) return;
  seenSigs.add(sig);

  if (seenSigs.size > 5000) {
    const arr = [...seenSigs];
    seenSigs = new Set(arr.slice(-2500));
  }

  const logs = value.logs || [];
  const isTokenCreate = logs.some(l =>
    l.includes('initialize_v2') ||
    l.includes('create_pool') ||
    l.includes('InitializeMint') ||
    l.includes('CreateAccount')
  );

  if (!isTokenCreate) return;

  const mintMatch = logs.join(' ').match(/([1-9A-HJ-NP-Za-km-z]{32,44})/g);
  const possibleMints = mintMatch ? mintMatch.filter(m =>
    m !== LETSBONK_PROGRAM && m.length >= 32 && m.length <= 44
  ) : [];

  if (possibleMints.length === 0) return;

  const coin = normalize({
    mint: possibleMints[0],
    name: '',
    symbol: '',
  }, 'new');

  console.log(`[BonkFun] New token detected: ${coin.mintAddress}`);
  emit(coin);

  if (possibleMints.length > 0) {
    enrichCoinData(coin, possibleMints[0]);
  }
}

async function enrichCoinData(coin, mintAddress) {
  try {
    const res = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
      { timeout: 8000 }
    );
    const pairs = res.data?.pairs;
    if (pairs && pairs.length > 0) {
      const pair = pairs[0];
      coin.name = pair.baseToken?.name || coin.name;
      coin.ticker = pair.baseToken?.symbol || coin.ticker;
      coin.priceUsd = parseFloat(pair.priceUsd) || 0;
      coin.marketCap = pair.marketCap || pair.fdv || 0;
      coin.liquiditySOL = pair.liquidity?.base || 0;
      if (pair.info?.socials) {
        const tw = pair.info.socials.find(s => s.type === 'twitter');
        const web = pair.info.websites?.[0];
        if (tw) { coin.twitterUrl = tw.url; coin.hasTwitter = true; }
        if (web) { coin.websiteUrl = web.url; coin.hasWebsite = true; }
      }
    }
  } catch {}
}

function fallbackToPolling() {
  if (!running) return;
  console.log('[BonkFun] Falling back to polling mode (RPC WebSocket unavailable)');
  mode = 'polling_fallback';
  pollViaRpc();
}

async function pollViaRpc() {
  if (!running) return;
  try {
    const rpc = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpc, 'confirmed');
    const programPubkey = new PublicKey(LETSBONK_PROGRAM);
    const sigs = await connection.getSignaturesForAddress(programPubkey, { limit: 10 });

    for (const sigInfo of sigs) {
      if (seenSigs.has(sigInfo.signature)) continue;
      seenSigs.add(sigInfo.signature);

      try {
        const tx = await connection.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || !tx.meta || tx.meta.err) continue;

        const logs = tx.meta.logMessages || [];
        const isCreate = logs.some(l =>
          l.includes('initialize_v2') || l.includes('InitializeMint')
        );
        if (!isCreate) continue;

        const accounts = tx.transaction.message.staticAccountKeys
          ? tx.transaction.message.staticAccountKeys.map(k => k.toBase58())
          : [];
        const possibleMint = accounts.find(a =>
          a !== LETSBONK_PROGRAM && a.length >= 32
        );
        if (!possibleMint) continue;

        const coin = normalize({ mint: possibleMint }, 'new');
        console.log(`[BonkFun] Poll: new token ${possibleMint}`);
        emit(coin);
        enrichCoinData(coin, possibleMint);
      } catch {}
    }
  } catch (e) {
    console.error('[BonkFun] Poll error:', e.message);
  }
  if (running) pollTimer = setTimeout(pollViaRpc, 30000);
}

function start() {
  if (running) return;
  running = true;
  mode = 'starting';
  connectLogsSubscribe();
  console.log('[BonkFun] Scanner started — monitoring LetsBonk program on-chain');
}

function stop() {
  running = false;
  mode = 'stopped';
  if (ws) { try { ws.close(); } catch {} ws = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  console.log('[BonkFun] Scanner stopped');
}

function getStatus() {
  return { running, mode, program: LETSBONK_PROGRAM };
}

module.exports = { start, stop, onCoin, clearCallbacks, getStatus };
