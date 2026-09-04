#!/usr/bin/env bash
# build-cards.sh — 由 SVG 生成全部卡片 PNG（rsvg-convert + Pango，fontconfig 正确解析 CJK）
# inject-*.svg 为"注入层"下三分之一卡片（逐卡累加一行，画面替换即字幕推进）
set -euo pipefail
cd "$(dirname "$0")"

gen() { # $1=输出名 $2=行1 $3=行2（可空） $4=行3（可空）
  local extra=""
  [ -n "${3:-}" ] && extra="$extra<text x=\"80\" y=\"606\" font-family=\"Noto Sans CJK SC\" font-weight=\"700\" font-size=\"36\" fill=\"#ffd166\">$3</text>"
  [ -n "${4:-}" ] && extra="$extra<text x=\"80\" y=\"652\" font-family=\"Noto Sans CJK SC\" font-weight=\"700\" font-size=\"36\" fill=\"#ff7b72\">$4</text>"
  cat > "$1" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <rect x="40" y="496" width="1200" height="184" rx="12" fill="black" fill-opacity="0.55"/>
  <text x="80" y="560" font-family="Noto Sans CJK SC" font-weight="700" font-size="36" fill="#f5f5f5">$2</text>
  $extra
</svg>
EOF
}

gen inject-1.svg "物理引擎 · 永远精确"
gen inject-2.svg "物理引擎 · 永远精确" "注入层 · 每只手一份隐藏偏差"
gen inject-3.svg "物理引擎 · 永远精确" "注入层 · 每只手一份隐藏偏差" "AI · 看不见自己的那只手"

for f in hook tail inject-1 inject-2 inject-3 cover; do
  rsvg-convert -o "${f}.png" "${f}.svg"
  echo "生成 ${f}.png"
done
