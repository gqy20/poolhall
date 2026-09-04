#!/usr/bin/env bash
# synth-bgm.sh — ffmpeg 程序化配乐（mmx music API 410 下线后的替代）
# 设计：A 小调暗色纪录片底
#   低频 drone（A1 55Hz + E2 82.4Hz）+ 粉红噪声低通垫底 = 全片"低频底噪"
#   稀疏 felt piano 单音（指数衰减正弦+泛音），读人段（80.4–109.2s）完全撤音
#   胜利段（109.2s+）转 A 大调色彩和声
set -euo pipefail
cd "$(dirname "$0")"

TOTAL=130.52
SR=32000

# 钢琴音符：时间|频率（读人段留空 = 音乐全撤只留底噪）
NOTES=(
  "4.0|220.00"   # A3
  "12.0|329.63"  # E4
  "21.0|261.63"  # C4
  "30.0|220.00"
  "38.0|293.66"  # D4
  "47.0|329.63"
  "55.0|261.63"
  "63.0|220.00"
  "72.0|196.00"  # G3
  "78.6|329.63"
  # —— 80.4–109.2 读人段：无音符，只留 drone + 底噪 ——
  "110.2|220.00" # 胜利 A 大三和弦分解
  "110.7|277.18" # C#4
  "111.2|329.63"
  "118.0|329.63"
  "124.6|220.00" # 片尾
  "128.0|220.00"
)

INPUTS=(
  -f lavfi -i "sine=frequency=55:sample_rate=${SR}:duration=${TOTAL}"
  -f lavfi -i "sine=frequency=82.41:sample_rate=${SR}:duration=${TOTAL}"
  -f lavfi -i "anoisesrc=color=pink:sample_rate=${SR}:duration=${TOTAL}:amplitude=0.35"
)
FILTER="[0:a]volume=0.50[d1];[1:a]volume=0.28[d2];\
[2:a]lowpass=f=280,volume='0.05+0.02*sin(2*PI*t/23)':eval=frame[pad];"

i=3
LABELS="[d1][d2][pad]"
for n in "${NOTES[@]}"; do
  t="${n%%|*}"; f="${n##*|}"
  ms=$(awk "BEGIN{printf \"%d\", $t*1000}")
  INPUTS+=(-f lavfi -i "aevalsrc=sin(2*PI*${f}*t)*exp(-2.8*t)+0.3*sin(4*PI*${f}*t)*exp(-4.5*t):s=${SR}:d=2.2")
  FILTER+="[${i}:a]volume=0.30,asetpts=N/SR/TB,adelay=${ms}[n${i}];"
  LABELS+="[n${i}]"
  i=$((i+1))
done
FILTER+="${LABELS}amix=inputs=$((i)):duration=first:dropout_transition=0:normalize=0,\
afade=t=in:st=0:d=1.5,afade=t=out:st=127.5:d=3.0[out]"

ffmpeg -y -hide_banner -loglevel error "${INPUTS[@]}" \
  -filter_complex "$FILTER" -map "[out]" \
  -ac 1 -ar ${SR} -c:a libmp3lame -b:a 192k ../bgm.mp3

ffprobe -v quiet -show_entries format=duration -of csv=p=0 ../bgm.mp3
