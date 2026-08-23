const HARD_LIMITS = {
  maxDevWalletPct: 15,
  maxTop10HoldersPct: 60,
  minLiquiditySOL: 1.5,
  minMarketCapUSD: 1500,
  maxMarketCapUSD: 5000000,
  requireSocials: true,
  maxCoinAgeMinutes: 60,
  minNameLength: 2,
  minTickerLength: 1,
  maxTickerLength: 10,
};

function quickSimCheck(coinData, solPrice) {
  const reasons = [];
  const warnings = [];
  const stage = coinData.stage || 'new';
  const sp = solPrice || 0;

  // --- Name & ticker validation ---
  const name = (coinData.name || '').trim();
  const ticker = (coinData.ticker || '').trim();
  if (name.length < HARD_LIMITS.minNameLength)
    reasons.push(`Name too short or missing ("${name}")`);
  if (ticker.length < HARD_LIMITS.minTickerLength)
    reasons.push(`Ticker missing`);
  else if (ticker.length > HARD_LIMITS.maxTickerLength)
    reasons.push(`Ticker "${ticker}" too long (${ticker.length} chars)`);

  // --- Liquidity ---
  const liq = parseFloat(coinData.liquiditySOL) || 0;
  if (stage === 'new') {
    if (liq < 0.5) reasons.push(`Liquidity ${liq.toFixed(2)} SOL too low for new coin`);
  } else if (stage === 'finalstretch') {
    if (liq < 3) reasons.push(`Liquidity ${liq.toFixed(2)} SOL too low for finalstretch`);
  } else {
    if (liq < HARD_LIMITS.minLiquiditySOL)
      reasons.push(`Liquidity ${liq.toFixed(2)} SOL below minimum ${HARD_LIMITS.minLiquiditySOL}`);
  }

  // --- Market cap ---
  const mcap = parseFloat(coinData.marketCap) || 0;
  const mcapUSD = sp && mcap > 0 && mcap < 50000 ? mcap * sp : mcap;
  if (stage === 'new') {
    if (mcapUSD > 0 && mcapUSD < 500) reasons.push(`Market cap $${Math.round(mcapUSD)} suspiciously low`);
  } else if (stage === 'finalstretch' || stage === 'migrated') {
    if (mcapUSD < 5000) reasons.push(`Market cap $${Math.round(mcapUSD)} too low for ${stage}`);
  } else {
    if (mcapUSD < HARD_LIMITS.minMarketCapUSD)
      reasons.push(`Market cap $${Math.round(mcapUSD)} below minimum $${HARD_LIMITS.minMarketCapUSD}`);
  }
  if (mcapUSD > HARD_LIMITS.maxMarketCapUSD)
    reasons.push(`Market cap $${Math.round(mcapUSD)} too high — likely topped out`);

  // --- Dev wallet (only enforce when data is available) ---
  const devPct = coinData.devWalletPct;
  if (devPct !== null && devPct !== undefined) {
    const dv = parseFloat(devPct);
    if (dv > HARD_LIMITS.maxDevWalletPct)
      reasons.push(`Dev wallet ${dv}% exceeds ${HARD_LIMITS.maxDevWalletPct}% limit`);
    else if (dv > 10)
      warnings.push(`Dev wallet ${dv}% is high`);
  } else if (stage !== 'new') {
    warnings.push('Dev wallet % unknown');
  }

  // --- Top 10 holders (only enforce when data is available) ---
  const top10 = coinData.top10HoldersPct;
  if (top10 !== null && top10 !== undefined) {
    const t10 = parseFloat(top10);
    if (t10 > HARD_LIMITS.maxTop10HoldersPct)
      reasons.push(`Top 10 holders ${t10}% exceeds ${HARD_LIMITS.maxTop10HoldersPct}% limit`);
    else if (t10 > 45)
      warnings.push(`Top 10 holders ${t10}% moderately concentrated`);
  } else if (stage !== 'new') {
    warnings.push('Top 10 holders % unknown');
  }

  // --- Socials ---
  if (HARD_LIMITS.requireSocials) {
    if (stage === 'new') {
      // new coins with zero socials get a warning, not hard reject
      if (!coinData.hasTwitter && !coinData.hasWebsite)
        warnings.push('No socials — lower confidence');
    } else {
      if (!coinData.hasTwitter && !coinData.hasWebsite)
        reasons.push('No Twitter or website');
    }
  }

  // --- Duplicate / spam name patterns ---
  if (name && /^(test|aaa|bbb|xxx|zzz|asdf)/i.test(name))
    reasons.push(`Name "${name}" looks like a test token`);
  if (ticker && /^(test|aaa|xxx|asdf)/i.test(ticker))
    reasons.push(`Ticker "${ticker}" looks like a test token`);

  // --- Coin age (if createdAt available) ---
  if (coinData.createdAt && HARD_LIMITS.maxCoinAgeMinutes) {
    const ageMs = Date.now() - (typeof coinData.createdAt === 'number' ? coinData.createdAt : new Date(coinData.createdAt).getTime());
    const ageMin = ageMs / 60000;
    if (ageMin > HARD_LIMITS.maxCoinAgeMinutes)
      reasons.push(`Coin is ${Math.round(ageMin)}m old — too stale`);
  }

  // --- Volume check for non-new coins ---
  if (stage !== 'new') {
    const vol = parseFloat(coinData.volume5m) || 0;
    if (vol === 0) warnings.push('Zero 5m volume');
  }

  return { passed: reasons.length === 0, reasons, warnings, simulated: true };
}

async function runSafetyCheck(coinData, solPrice) {
  return quickSimCheck(coinData, solPrice);
}

module.exports = { quickSimCheck, runSafetyCheck, HARD_LIMITS };
