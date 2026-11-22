#!/bin/bash
# The landing's hero reel (public/reel.mp4 + reel.jpg): 7 shots x 2.4 s from finished episodes, 0.5 s crossfades, shot 1
# repeated at the end so the loop seam is a crossfade too. 1280x720 30 fps, two-pass H.264 at ~1.4 Mb/s (~2.3 MB).
# CPU only (ffmpeg); needs math/<slug>/video.mp4 for every shot. Run from site/: scripts/reel.sh   (OUT=dir to try elsewhere)
set -euo pipefail
cd "$(dirname "$0")/.."
M="$(cd .. && pwd)/math" OUT="${OUT:-public}" T="$(mktemp -d)"
D=2.4 X=0.5
CROP="crop=iw*0.86:ih*0.86:iw*0.07:ih*0.10,"   # drops the OUR ENGINE / OUR SIMULATION corner label
shots=(                                         # slug, start second, extra filter
  "moon-closer 0.3 "
  "four-color 0.5 $CROP"
  "three-body-5 456.8 hflip,"                   # mirrored so the calm side sits under the headline
  "evolved-star-system 398.0 "
  "fold 27.2 "
  "parrondo 306.1 $CROP"
  "grabby-aliens 0.3 "
)
i=0
for s in "${shots[@]}"; do
  read -r slug t vf <<< "$s"
  nice ffmpeg -nostdin -v error -y -ss "$t" -i "$M/$slug/video.mp4" -t $D -an \
    -vf "fps=30,${vf}scale=1280:720:flags=lanczos,format=yuv420p,settb=1/30" -c:v libx264 -crf 10 -preset fast "$T/$i.mp4" &
  i=$((i + 1))
done
wait
n=${#shots[@]} in=() fc="" prev="0:v"
for k in $(seq 0 $((n - 1))); do in+=(-i "$T/$k.mp4"); done
in+=(-i "$T/0.mp4")
for k in $(seq 1 "$n"); do
  fc="$fc[$prev][$k:v]xfade=transition=fade:duration=$X:offset=$(python3 -c "print(round($k*($D-$X),3))")[x$k];"
  prev="x$k"
done
fc="$fc[$prev]trim=start=$X:end=$(python3 -c "print(round($n*($D-$X)+$X,3))"),setpts=PTS-STARTPTS,format=yuv420p[out]"
nice ffmpeg -nostdin -v error -y "${in[@]}" -filter_complex "$fc" -map "[out]" -c:v libx264 -crf 8 -preset fast "$T/master.mp4"
for pass in 1 2; do
  nice ffmpeg -nostdin -v error -y -i "$T/master.mp4" -an -c:v libx264 -preset slow -b:v 1400k -pass $pass -passlogfile "$T/x264" \
    -pix_fmt yuv420p -movflags +faststart $([ $pass = 1 ] && echo "-f mp4 /dev/null" || echo "$OUT/reel.mp4")
done
ffmpeg -nostdin -v error -y -ss 0.2 -i "$OUT/reel.mp4" -frames:v 1 -q:v 4 "$OUT/reel.jpg"
rm -rf "$T"
ls -l "$OUT/reel.mp4" "$OUT/reel.jpg"
