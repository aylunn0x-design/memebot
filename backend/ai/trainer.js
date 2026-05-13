const fs = require('fs');
const path = require('path');

const TRAINING_FILE = path.join(__dirname, '../../data/training.json');

const DEFAULT_WEIGHTS = {
  social_legitimacy: 1.0, holder_distribution: 1.2, dev_wallet_safety: 1.3,
  liquidity: 1.0, narrative_strength: 0.9, contract_safety: 1.4,
  has_twitter: 0.8, has_website: 0.6,
  stage_new: 1.1, stage_finalstretch: 1.2, stage_migrated: 0.9,
};

let trainingData = { weights: { ...DEFAULT_WEIGHTS }, samples: [], totalTrades: 0, wins: 0, losses: 0, lastTrained: null };

function load() {
  if (fs.existsSync(TRAINING_FILE)) {
    try { trainingData = { ...trainingData, ...JSON.parse(fs.readFileSync(TRAINING_FILE, 'utf8')) }; } catch {}
  }
}

function save() { fs.writeFileSync(TRAINING_FILE, JSON.stringify(trainingData, null, 2)); }

function logOutcome(trade) {
  const sample = { id: trade.id, timestamp: new Date().toISOString(), coinData: trade.coinData, aiScore: trade.aiScore, entryPrice: trade.entryPrice, exitPrice: trade.exitPrice, pnlSol: trade.pnlSol, win: trade.pnlSol > 0, holdTimeSeconds: trade.holdTimeSeconds, platform: trade.platform, stage: trade.stage, features: trade.features || {} };
  trainingData.samples.push(sample);
  trainingData.totalTrades++;
  if (sample.win) trainingData.wins++; else trainingData.losses++;
  if (trainingData.samples.length > 500) trainingData.samples.shift();
  if (trainingData.totalTrades % 10 === 0) retrain();
  save();
  return sample;
}

function retrain() {
  const samples = trainingData.samples;
  if (samples.length < 5) return { success: false, reason: 'Not enough samples' };
  console.log(`[Trainer] Retraining on ${samples.length} samples...`);
  const newWeights = { ...trainingData.weights };
  Object.keys(DEFAULT_WEIGHTS).forEach(feature => {
    const relevant = samples.filter(s => s.features && s.features[feature] !== undefined);
    if (relevant.length < 3) return;
    const wins = relevant.filter(s => s.win);
    const losses = relevant.filter(s => !s.win);
    if (!wins.length || !losses.length) return;
    const avgWin = wins.reduce((a, s) => a + (s.features[feature] || 0), 0) / wins.length;
    const avgLoss = losses.reduce((a, s) => a + (s.features[feature] || 0), 0) / losses.length;
    const ratio = avgLoss > 0 ? avgWin / avgLoss : 1;
    const adj = (ratio - 1) * 0.1;
    newWeights[feature] = Math.max(0.1, Math.min(2.0, newWeights[feature] + adj));
  });
  trainingData.weights = newWeights;
  trainingData.lastTrained = new Date().toISOString();
  save();
  const wr = trainingData.totalTrades > 0 ? (trainingData.wins / trainingData.totalTrades * 100).toFixed(1) : 0;
  console.log(`[Trainer] Done. WR: ${wr}%`);
  return { success: true, weights: newWeights, winRate: parseFloat(wr), samples: samples.length };
}

function applyWeights(rawFeatures) {
  const weights = trainingData.weights;
  let weighted = 0, total = 0;
  Object.entries(rawFeatures).forEach(([f, v]) => { const w = weights[f] || 1.0; weighted += v * w; total += w; });
  return total === 0 ? 50 : Math.min(100, Math.max(0, Math.round(weighted / total)));
}

function getStats() {
  return { totalTrades: trainingData.totalTrades, wins: trainingData.wins, losses: trainingData.losses, winRate: trainingData.totalTrades > 0 ? Math.round(trainingData.wins / trainingData.totalTrades * 1000) / 10 : 0, samples: trainingData.samples.length, lastTrained: trainingData.lastTrained, weights: trainingData.weights };
}

function resetWeights() { trainingData.weights = { ...DEFAULT_WEIGHTS }; save(); return trainingData.weights; }

load();
module.exports = { logOutcome, retrain, applyWeights, getStats, resetWeights };
