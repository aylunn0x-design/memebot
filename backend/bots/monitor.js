const axios = require('axios');
const { parse } = require('node-html-parser');
const { classifyTweet } = require('../ai/classifier');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../../data/monitor_state.json');

const NITTER_INSTANCES = [
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
  'https://nitter.lunar.icu',
];

let monitorState = {
  accounts: [],
  pollIntervalSeconds: 15,
  minDeployScore: 75,
  skipRetweets: true,
  skipReplies: true,
  manualApproval: false,
  running: false,
  lastSeen: {},
  tweetLog: [],
};

let pollTimer = null;
let signalCallbacks = [];

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      monitorState = { ...monitorState, ...saved, running: false };
    } catch {}
  }
}

function saveState() {
  const toSave = { ...monitorState, running: false };
  fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
}

function onSignal(cb) {
  signalCallbacks.push(cb);
}

function emitSignal(signal) {
  signalCallbacks.forEach(cb => cb(signal));
}

async function fetchTweets(username) {
  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}/${username}`;
      const res = await axios.get(url, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' },
      });
      const root = parse(res.data);
      const items = root.querySelectorAll('.timeline-item');
      const tweets = [];
      for (const item of items.slice(0, 10)) {
        if (monitorState.skipRetweets && item.querySelector('.retweet-header')) continue;
        if (monitorState.skipReplies && item.querySelector('.replying-to')) continue;
        const contentEl = item.querySelector('.tweet-content');
        const linkEl = item.querySelector('.tweet-link');
        if (!contentEl) continue;
        const text = contentEl.text.trim();
        const link = linkEl ? linkEl.getAttribute('href') : '';
        const idMatch = link.match(/status\/(\d+)/);
        const id = idMatch ? idMatch[1] : Date.now().toString();
        tweets.push({ id, text, username, url: link });
      }
      return tweets;
    } catch (e) {
      console.log(`[Monitor] ${instance} failed, trying next...`);
      continue;
    }
  }
  console.error(`[Monitor] All Nitter instances failed for @${username}`);
  return [];
}

async function processAccount(username) {
  const tweets = await fetchTweets(username);
  if (!tweets.length) return;

  const lastSeen = monitorState.lastSeen[username] || '0';
  const newTweets = tweets.filter(t => t.id > lastSeen);
  if (!newTweets.length) return;

  monitorState.lastSeen[username] = tweets[0].id;

  for (const tweet of newTweets) {
    console.log(`[Monitor] New tweet from @${username}: "${tweet.text.slice(0, 60)}..."`);
    const classification = await classifyTweet(tweet.text, username);

    const logEntry = {
      id: tweet.id,
      username,
      text: tweet.text,
      url: tweet.url,
      timestamp: new Date().toISOString(),
      classification,
    };

    monitorState.tweetLog.unshift(logEntry);
    if (monitorState.tweetLog.length > 100) monitorState.tweetLog.pop();

    console.log(`[Monitor] Score: ${classification.score} | Deployable: ${classification.deployable} | Ticker: $${classification.suggested_ticker}`);

    if (classification.deployable && classification.score >= monitorState.minDeployScore) {
      if (monitorState.manualApproval) {
        console.log(`[Monitor] Manual approval required for $${classification.suggested_ticker}`);
        emitSignal({ ...logEntry, status: 'pending_approval' });
      } else {
        console.log(`[Monitor] 🚀 Deploying $${classification.suggested_ticker} on ${classification.platform}`);
        emitSignal({ ...logEntry, status: 'auto_deploy' });
      }
    }

    saveState();
  }
}

async function poll() {
  if (!monitorState.running) return;
  console.log(`[Monitor] Polling ${monitorState.accounts.length} accounts...`);
  for (const username of monitorState.accounts) {
    await processAccount(username);
    await new Promise(r => setTimeout(r, 1500));
  }
}

function start() {
  if (monitorState.running) return { success: false, error: 'Already running' };
  if (!monitorState.accounts.length) return { success: false, error: 'No accounts to monitor' };
  monitorState.running = true;
  poll();
  pollTimer = setInterval(poll, monitorState.pollIntervalSeconds * 1000);
  console.log(`[Monitor] Started — watching ${monitorState.accounts.length} accounts every ${monitorState.pollIntervalSeconds}s`);
  return { success: true };
}

function stop() {
  monitorState.running = false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  console.log('[Monitor] Stopped');
  return { success: true };
}

function addAccount(username) {
  const clean = username.replace('@', '').trim().toLowerCase();
  if (monitorState.accounts.includes(clean)) return { success: false, error: 'Already tracking' };
  monitorState.accounts.push(clean);
  saveState();
  return { success: true, accounts: monitorState.accounts };
}

function removeAccount(username) {
  const clean = username.replace('@', '').trim().toLowerCase();
  monitorState.accounts = monitorState.accounts.filter(a => a !== clean);
  saveState();
  return { success: true, accounts: monitorState.accounts };
}

function updateSettings(settings) {
  if (settings.pollIntervalSeconds) monitorState.pollIntervalSeconds = settings.pollIntervalSeconds;
  if (settings.minDeployScore !== undefined) monitorState.minDeployScore = settings.minDeployScore;
  if (settings.skipRetweets !== undefined) monitorState.skipRetweets = settings.skipRetweets;
  if (settings.skipReplies !== undefined) monitorState.skipReplies = settings.skipReplies;
  if (settings.manualApproval !== undefined) monitorState.manualApproval = settings.manualApproval;
  if (settings.pollIntervalSeconds && monitorState.running) {
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, monitorState.pollIntervalSeconds * 1000);
  }
  saveState();
  return { success: true, settings: getStatus() };
}

function approveSignal(tweetId) {
  const entry = monitorState.tweetLog.find(t => t.id === tweetId);
  if (!entry) return { success: false, error: 'Tweet not found' };
  emitSignal({ ...entry, status: 'auto_deploy' });
  return { success: true };
}

function getStatus() {
  return {
    running: monitorState.running,
    accounts: monitorState.accounts,
    pollIntervalSeconds: monitorState.pollIntervalSeconds,
    minDeployScore: monitorState.minDeployScore,
    skipRetweets: monitorState.skipRetweets,
    skipReplies: monitorState.skipReplies,
    manualApproval: monitorState.manualApproval,
    tweetLog: monitorState.tweetLog.slice(0, 50),
  };
}

loadState();

module.exports = {
  start,
  stop,
  addAccount,
  removeAccount,
  updateSettings,
  approveSignal,
  getStatus,
  onSignal,
};
