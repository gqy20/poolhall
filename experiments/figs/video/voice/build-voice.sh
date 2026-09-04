#!/usr/bin/env bash
# build-voice.sh — 把 17 句配音按对轨表铺到 130.52s 静音底上，出完整配音轨 + SRT
# 对轨依据：editing-guide.md 的 8 段时间轴 + 13.0s 处插 1s 黑场（其后全部 +1s）+ 片尾 6s 黑场
set -euo pipefail
cd "$(dirname "$0")"

TOTAL=130.52
# id|起始秒（终版时间轴）
PLACEMENTS=(
  "01-hook|12.20"   # 段1 定格+黑场：钩子句
  "02-open|17.00"   # 段2 两 AI 入座
  "03-fail1|26.00"  # 段3 连续翻车
  "04-fail2|28.60"
  "05-fail3|34.50"
  "06-turn1|43.00"  # 段4 转折：连进 7 球
  "07-turn2|48.50"
  "08-turn3|52.00"
  "09-plan1|70.00"  # 段5 内心戏面板
  "10-plan2|74.00"
  "11-read1|82.50"  # 段6 读人 #3（语速 0.82）
  "12-read2|86.50"  #   其后 89.5–93.1 旁白停，模型原文上屏
  "13-read3|97.50"  # 段7 读人 #4
  "14-read4|105.50" #   前留 2s 停顿
  "15-end1|111.00"  # 段8 收尾
  "16-end2|115.00"
  "17-end3|125.30"  # 片尾黑场片名卡
)

# 1) 组装 ffmpeg 输入与 adelay 滤镜
INPUTS=(-f lavfi -i "anullsrc=r=32000:cl=mono:d=${TOTAL}")
FILTER="[0:a]anull[base];"
LABELS=()
i=1
for p in "${PLACEMENTS[@]}"; do
  id="${p%%|*}"; t="${p##*|}"
  ms=$(awk "BEGIN{printf \"%d\", $t*1000}")
  INPUTS+=(-i "lines/${id}.mp3")
  FILTER+="[${i}:a]asetpts=N/SR/TB,adelay=${ms}[d${i}];"
  LABELS+=("[d${i}]")
  i=$((i+1))
done
FILTER+="[base]$(IFS=; echo "${LABELS[*]}")amix=inputs=18:duration=first:dropout_transition=0:normalize=0[out]"

ffmpeg -y -hide_banner -loglevel error "${INPUTS[@]}" \
  -filter_complex "$FILTER" -map "[out]" \
  -ac 1 -ar 32000 -c:a libmp3lame -b:a 128k ../voiceover.mp3

# 2) 生成 SRT（起始=对轨表，结束=起始+逐句实测时长）
: > ../voiceover.srt
n=1
for p in "${PLACEMENTS[@]}"; do
  id="${p%%|*}"; t="${p##*|}"
  dur=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "lines/${id}.mp3")
  text=$(sed -n '3p' "lines/${id}.srt")
  st=$(awk "BEGIN{h=int($t/3600);m=int($t%3600/60);s=$t%60;printf \"%02d:%02d:%06.3f\",h,m,s}" | tr '.' ',')
  et=$(awk "BEGIN{e=$t+$dur;h=int(e/3600);m=int(e%3600/60);s=e%60;printf \"%02d:%02d:%06.3f\",h,m,s}" | tr '.' ',')
  printf "%d\n%s --> %s\n%s\n\n" "$n" "$st" "$et" "$text" >> ../voiceover.srt
  n=$((n+1))
done

echo "== ../voiceover.mp3 =="
ffprobe -v quiet -show_entries format=duration -of csv=p=0 ../voiceover.mp3
echo "== SRT =="
cat ../voiceover.srt
