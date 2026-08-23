require('dotenv').config();
const express = require('express');
const cors = require('cors');

const walletManager = require('./wallets/manager');
const monitor = require('./bots/monitor');
const deployer = require('./bots/deployer');
const trader = require('./bots/trader');
const market = require('./ai/market');
const trainer = require('./ai/trainer');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/wallets', (req, res) => {
  try { res.json({ success: true, data: walletManager.getAllWallets() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/wallets/generate', (req, res) => {
  try {
    const { label, type } = req.body;
    res.json({ success: true, data: walletManager.generateWallet(label || `Trader W${Date.now()}`, type || 'trader') });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/wallets/import', (req, res) => {
  try {
    const { privateKey, label, type } = req.body;
    if (!privateKey) return res.status(400).json({ success: false, error: 'Private key required' });
    res.json({ success: true, data: walletManager.importWallet(privateKey, label || 'Imported', type || 'trader') });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

app.delete('/api/wallets/:id', (req, res) => {
  try { res.json(walletManager.removeWallet(req.params.id)); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.patch('/api/wallets/:id/label', (req, res) => {
  try { res.json({ success: true, data: walletManager.swapWalletLabel(req.params.id, req.body.label) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/wallets/balances', async (req, res) => {
  try { res.json({ success: true, data: await walletManager.getAllBalances() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/wallets/bundle/generate', (req, res) => {
  try { res.json({ success: true, data: walletManager.generateBundleWallets(req.body.count || 6) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/wallets/bundle/amounts', (req, res) => {
  try {
    const { total, count } = req.body;
    if (!total || !count) return res.status(400).json({ success: false, error: 'total and count required' });
    res.json({ success: true, data: walletManager.randomizeBundleAmounts(parseFloat(total), parseInt(count)) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/monitor/status', (req, res) => {
  res.json({ success: true, data: monitor.getStatus() });
});

app.post('/api/monitor/start', (req, res) => { res.json(monitor.start()); });
app.post('/api/monitor/stop', (req, res) => { res.json(monitor.stop()); });

app.post('/api/monitor/accounts', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ success: false, error: 'username required' });
  res.json(monitor.addAccount(username));
});

app.delete('/api/monitor/accounts/:username', (req, res) => {
  res.json(monitor.removeAccount(req.params.username));
});

app.patch('/api/monitor/settings', (req, res) => {
  res.json(monitor.updateSettings(req.body));
});

app.post('/api/monitor/approve/:tweetId', (req, res) => {
  res.json(monitor.approveSignal(req.params.tweetId));
});

monitor.onSignal(async (signal) => {
  const liveMode = process.env.LIVE_MODE === 'true';
  try { await deployer.deploy(signal, liveMode); }
  catch (e) { console.error('[Server] Deploy failed:', e.message); }
});

app.get('/api/deployer/status', (req, res) => {
  res.json({ success: true, data: deployer.getStatus() });
});

app.post('/api/deployer/config', (req, res) => {
  res.json({ success: true, data: deployer.updateConfig(req.body) });
});

app.post('/api/deployer/deploy', async (req, res) => {
  try {
    const { signal, liveMode } = req.body;
    if (!signal) return res.status(400).json({ success: false, error: 'signal required' });
    res.json({ success: true, data: await deployer.deploy(signal, liveMode || false) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/trader/status', (req, res) => {
  res.json({ success: true, data: trader.getStatus() });
});

app.post('/api/trader/start', (req, res) => { res.json(trader.start()); });
app.post('/api/trader/stop', (req, res) => { res.json(trader.stop()); });

app.patch('/api/trader/config', (req, res) => {
  res.json({ success: true, data: trader.updateConfig(req.body) });
});

app.get('/api/trader/feed', (req, res) => {
  res.json({ success: true, data: trader.getFeed() });
});

app.get('/api/market', (req, res) => {
  res.json({ success: true, data: market.getState() });
});

app.post('/api/market/update', async (req, res) => {
  try { res.json({ success: true, data: await market.update() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/trainer/stats', (req, res) => {
  res.json({ success: true, data: trainer.getStats() });
});

app.post('/api/trainer/retrain', (req, res) => {
  res.json({ success: true, data: trainer.retrain() });
});

app.post('/api/trainer/reset', (req, res) => {
  res.json({ success: true, data: { weights: trainer.resetWeights() } });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    time: new Date().toISOString(),
    rpc: process.env.RPC_URL || 'public',
    liveMode: process.env.LIVE_MODE === 'true',
  });
});

market.startAutoUpdate();

app.listen(PORT, () => {
  console.log(`\n🤖 MEMEBOT Backend — port ${PORT}`);
  console.log(`📡 RPC: ${process.env.RPC_URL || 'public mainnet'}`);
  console.log(`🧠 AI: Claude Sonnet`);
  console.log(`🔴 Live mode: ${process.env.LIVE_MODE === 'true' ? 'ON' : 'OFF (simulation)'}`);
  console.log(`🔗 http://localhost:${PORT}/api/health\n`);
});

module.exports = app;