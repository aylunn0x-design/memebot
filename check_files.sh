#!/bin/bash
echo "Checking all bot files..."
files=(
  "backend/server.js"
  "backend/wallets/manager.js"
  "backend/bots/monitor.js"
  "backend/bots/deployer.js"
  "backend/bots/trader.js"
  "backend/ai/classifier.js"
  "backend/ai/market.js"
  "backend/ai/trainer.js"
  "backend/scanners/pumpfun.js"
  "backend/scanners/bonkfun.js"
  "backend/scanners/bagsfm.js"
  "backend/safety/checks.js"
)
all_good=true
for f in "${files[@]}"; do
  size=$(wc -c < "$f" 2>/dev/null || echo 0)
  if [ "$size" -lt 100 ]; then
    echo "❌ $f is empty or missing ($size bytes)"
    all_good=false
  else
    echo "✅ $f ($size bytes)"
  fi
done
if $all_good; then echo "\n✅ All files intact"; else echo "\n❌ Some files need restoring"; fi
