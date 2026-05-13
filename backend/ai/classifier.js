let anthropic = null;

function getClient() {
  if (!anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

async function classifyTweet(tweet, username) {
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: `You are a memecoin launch analyst. Analyze this tweet and determine if it's suitable for launching a memecoin.

Tweet from @${username}: "${tweet}"

Respond ONLY with a JSON object, no markdown:
{"deployable":true/false,"score":0-100,"narrative_type":"politics|tech|meme|culture|finance|sports|other","platform":"bonkfun|pumpfun","suggested_name":"coin name","suggested_ticker":"TICKER","reason":"one sentence","keywords":["kw1","kw2"]}

Rules: deployable true only if score>=75. platform is bonkfun for politics/elections/government/Trump, otherwise pumpfun.` }],
    });
    const clean = response.content[0].text.trim().replace(/\`\`\`json|\`\`\`/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('[Classifier] Error:', e.message);
    return { deployable: false, score: 0, narrative_type: 'other', platform: 'pumpfun', suggested_name: '', suggested_ticker: '', reason: 'Classification failed', keywords: [] };
  }
}

async function scoreCoin(coinData) {
  // If no API key, use rule-based scoring
  if (!process.env.ANTHROPIC_API_KEY) {
    return ruleBasedScore(coinData);
  }
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: `You are a memecoin trading analyst. Score this coin 0-100 for buy potential.

Coin: ${coinData.name} $${coinData.ticker} on ${coinData.platform}
Stage: ${coinData.stage} | Twitter: ${coinData.hasTwitter?'yes':'no'} | Website: ${coinData.hasWebsite?'yes':'no'}
Dev wallet: ${coinData.devWalletPct||'unknown'}% | Top 10 holders: ${coinData.top10HoldersPct||'unknown'}%
Liquidity: ${coinData.liquiditySOL||'unknown'} SOL | Market cap: ${coinData.marketCap||'unknown'}
SOL trend: ${coinData.solTrend||'neutral'} | Market: ${coinData.marketVolume||'normal'}

Respond ONLY with JSON, no markdown:
{"score":0-100,"buy":true/false,"reason":"one sentence","risk_level":"low|medium|high","suggested_position_sol":0.1-2.0,"red_flags":["flag1"]}

Rules: buy true only if score>=70. Never buy if dev wallet>15% or top holders>60%.` }],
    });
    const clean = response.content[0].text.trim().replace(/\`\`\`json|\`\`\`/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('[Scorer] Error:', e.message);
    return ruleBasedScore(coinData);
  }
}

function ruleBasedScore(coinData) {
  let score = 50;
  if (coinData.hasTwitter) score += 10;
  if (coinData.hasWebsite) score += 8;
  if (coinData.stage === 'finalstretch') score += 12;
  if (coinData.stage === 'new') score += 5;
  if (coinData.devWalletPct && parseFloat(coinData.devWalletPct) > 15) score -= 30;
  if (coinData.top10HoldersPct && parseFloat(coinData.top10HoldersPct) > 60) score -= 20;
  if (coinData.liquiditySOL && parseFloat(coinData.liquiditySOL) > 10) score += 10;
  if (coinData.ticker && coinData.ticker.length <= 5) score += 5;
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    buy: score >= 70,
    reason: 'Rule-based score (no API key)',
    risk_level: score >= 75 ? 'low' : score >= 60 ? 'medium' : 'high',
    suggested_position_sol: score >= 80 ? 0.8 : 0.4,
    red_flags: [],
  };
}

module.exports = { classifyTweet, scoreCoin };
