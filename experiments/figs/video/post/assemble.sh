#!/usr/bin/env bash
# assemble.sh — 终版装配
#   视频：draft-v2 + 13.0s 处插 1s 钩子黑场 + 注入层下三分之一卡片(48.5–58s) + 6s 片尾卡
#   音频：voiceover(1.0) + bgm(0.25)，读人段 BGM 天然只剩低频底噪（音符表留空）
# 产出：poolhall-final.mp4 (130.52s, H.264+AAC+faststart)
set -euo pipefail
cd "$(dirname "$0")/.."

ffmpeg -y -hide_banner -loglevel error \
  -i poolhall-draft-v2.mp4 \
  -loop 1 -framerate 25 -t 1 -i post/cards/hook.png \
  -loop 1 -framerate 25 -t 6 -i post/cards/tail.png \
  -loop 1 -framerate 25 -i post/cards/inject-1.png \
  -loop 1 -framerate 25 -i post/cards/inject-2.png \
  -loop 1 -framerate 25 -i post/cards/inject-3.png \
  -i voiceover.mp3 \
  -i bgm.mp3 \
  -filter_complex "\
[0:v]trim=0:13,setpts=PTS-STARTPTS[va];\
[0:v]trim=start=13,setpts=PTS-STARTPTS[vb];\
[1:v]fps=25,format=yuv420p,setsar=1,trim=duration=1[hk];\
[2:v]fps=25,format=yuv420p,setsar=1,trim=duration=6[tl];\
[va][hk][vb][tl]concat=n=4:v=1:a=0[vcat];\
[vcat][3:v]overlay=0:0:enable='between(t,48.5,52.0)'[v1];\
[v1][4:v]overlay=0:0:enable='between(t,52.0,54.5)'[v2];\
[v2][5:v]overlay=0:0:enable='between(t,54.5,58.0)'[vout];\
[6:a]volume=1.0[vv];\
[7:a]volume=0.25[bb];\
[vv][bb]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 25 \
  -c:a aac -b:a 192k -movflags +faststart -t 130.52 \
  poolhall-final.mp4

echo "== 成品 =="
ffprobe -v quiet -show_entries format=duration,size -of default=nw=1 poolhall-final.mp4
ffmpeg -hide_banner -i poolhall-final.mp4 -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
