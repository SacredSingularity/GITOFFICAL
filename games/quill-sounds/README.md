# Quill sound effects

Drop MP3 files into this folder using these exact filenames. `games/quill.html`
references them by name and silently skips playback if a file is missing, so
the app works with none, some, or all of them present.

| Filename        | Triggered when                                              | Suggested tone |
|------------------|--------------------------------------------------------------|-----------------|
| `correct.mp3`    | A multiple-choice or number-input answer is correct           | short, bright chime |
| `incorrect.mp3`  | An answer is wrong                                             | soft, gentle — never harsh/buzzer-like |
| `complete.mp3`   | A lesson is finished (plays alongside the big confetti burst)  | short fanfare / cheer |
| `achievement.mp3`| A new badge is unlocked                                        | sparkly "ta-da" |
| `click.mp3`      | Light UI taps — nav items, opening a lesson, reveal-hint toggle| subtle pop/tap, low volume |

Keep each file short (well under 2s for `correct`/`incorrect`/`click`, under
4s for `complete`/`achievement`) since they can overlap with rapid taps.
Volume is normalized to 70% in code, so mix them reasonably close to each
other rather than relying on the browser to balance loud vs. quiet files.

A "Sound effects" toggle in Settings (on by default, stored per-device in
`localStorage`) lets users mute all of these at once.
