# Desktop

On a Linux computer with a screen, everything goes through shell. `DISPLAY` is set in the environment: use it, never guess another. Install what is missing with `sudo apt-get install -y imagemagick scrot xdotool wmctrl ffmpeg`.

## See

- Whole screen: `import -window root /tmp/screen.png` (or `scrot -o /tmp/screen.png`), then open it with read.
- Windows: `wmctrl -l` lists ids and titles; `xdotool getdisplaygeometry` gives the screen size.
- Coordinates in a full screenshot are screen coordinates.

## Act

Look, act in one small batch, look again. Keep using the browser CLI and its refs for web pages; use xdotool for everything else.

- Start an app so shell returns: `setsid APP >/tmp/app.log 2>&1 </dev/null &`, then wait until `xdotool search --sync --onlyvisible --class APP` finds its window.
- Focus: `wmctrl -a "Title"` or `xdotool search --onlyvisible --name "Title" windowactivate --sync`.
- Click: `xdotool mousemove --sync X Y click 1`, with X and Y from the latest screenshot.
- Type and keys: `xdotool type --delay 80 "text"`, `xdotool key ctrl+s`, `xdotool key Return`.

## Record

Record only when motion is the proof, such as a flow across screens. Start ffmpeg in the background with a hard cap (`-t`, at most 60 seconds):

```sh
setsid ffmpeg -y -loglevel error -f x11grab -framerate 15 -video_size "$(xdotool getdisplaygeometry | tr ' ' x)" -i "$DISPLAY" -t 60 -vf "scale='min(1280,iw)':-2" -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -movflags +faststart /tmp/clip.mp4 </dev/null >/tmp/ffmpeg.log 2>&1 &
echo $! >/tmp/ffmpeg.pid
```

- Do the steps, then stop with `kill -INT "$(cat /tmp/ffmpeg.pid)"` and wait until `kill -0` on that pid fails. A recording killed any other way does not play.
- Check it: `ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/clip.mp4` prints its length.
- Attach the mp4 with message_post. It must stay under 10 MB; if it does not, record shorter or send screenshots.
