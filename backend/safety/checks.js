const HARD_LIMITS = { maxDevWalletPct: 15, maxTop10HoldersPct: 60, minLiquiditySOL: 1 };

function quickSimCheck(coinData) {
  const reasons = [], warnings = [];
  if (coinData.devWalletPct && parseFloat(coinData.devWalletPct) > HARD_LIMITS.maxDevWalletPct)
    reasons.push(`Dev wallet ${coinData.devWalletPct}% exceeds limit`);
  if (coinData.top10HoldersPct && parseFloat(coinData.top10HoldersPct) > HARD_LIMITS.maxTop10HoldersPct)
    reasons.push(`Top 10 holders ${coinData.top10HoldersPct}% exceeds limit`);
  if (!coinData.hasTwitter && !coinData.hasWebsite)
    warnings.push('No social links');
  return { passed: reasons.length === 0, reasons, warnings, simulated: true };
}

async function runSafetyCheck(coinData) {
  return quickSimCheck(coinData);
}

module.exports = { quickSimCheck, runSafetyCheck, HARD_LIMITS };
