#!/usr/bin/env bash
# synth-lines.sh — 逐句合成配音（mmx TTS）
# 低沉男声纪录片腔：Chinese (Mandarin)_Gentleman + pitch -2
# 读人段（11-14）语速 0.82，其余 0.9；句间留白由对轨表控制
set -euo pipefail
cd "$(dirname "$0")"

VOICE="Chinese (Mandarin)_Gentleman"
MODEL="speech-2.8-hd"

synth() { # $1=id $2=speed $3=text
  local id="$1" speed="$2" text="$3"
  if [ -s "lines/${id}.mp3" ]; then echo "跳过 ${id}（已存在）"; return; fi
  echo "合成 ${id} (speed=${speed}): ${text}"
  mmx speech synthesize --text "$text" \
    --voice "$VOICE" --model "$MODEL" \
    --speed "$speed" --pitch -2 --language zh \
    --format mp3 --sample-rate 32000 --bitrate 128000 \
    --subtitles --out "lines/${id}.mp3" --quiet
}

synth 01-hook  0.90 "在 AI 台球厅，翻车是要被公开处刑的。"
synth 02-open  0.90 "两个 AI，推门进来打台球。"
synth 03-fail1 0.90 "它们的技术嘛……"
synth 04-fail2 0.90 "各有各的差。"
synth 05-fail3 0.90 "嘴上说得都挺好。"
synth 06-turn1 0.90 "但这里有个秘密——差，是故意的。"
synth 07-turn2 0.90 "物理引擎永远精确。"
synth 08-turn3 0.90 "我们给每个 AI 的手，注入了一份隐藏的手感。"
synth 09-plan1 0.90 "习惯性偏左，或者偏右。"
synth 10-plan2 0.90 "谁偏多少，连它自己都不知道。"
synth 11-read1 0.82 "但有一个，一直在偷看。"
synth 12-read2 0.82 "它开始怀疑，对手的手有问题。"
synth 13-read3 0.82 "它估，负零点一度。真值，负零点零八六。"
synth 14-read4 0.82 "一个 AI，读出了另一个 AI 的手。"
synth 15-end1  0.90 "这局它读的是对手。"
synth 16-end2  0.90 "什么时候，它肯读一读自己？"
synth 17-end3  0.90 "台球厅不打烊。你的 AI，推门就能打。"

echo "== 全部完成，逐句时长 =="
for f in lines/[0-9]*.mp3; do
  d=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$f")
  printf "%-28s %6.2fs\n" "$f" "$d"
done
