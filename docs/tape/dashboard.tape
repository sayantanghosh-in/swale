# The hero recording: the dashboard, the palette, a skill, and the agent
# drawing a calendar from a plain-English question.

Output docs/images/dashboard.gif
Source docs/tape/_settings.tape

# Taller than the default so the mark survives the whole recording.
Set Height 1000

Hide
Type "export SWALE_DATA_DIR=/tmp/swale-demo"  Enter
# Run this week's scheduled skills off-camera, so the recording opens on the
# dashboard rather than five catch-up reports.
Type "swale brief --run >/dev/null 2>&1; clear"  Enter
Sleep 15s
Type "export PS1='\033[38;5;208m❯\033[0m '"  Enter
Type "clear"  Enter
Show

Sleep 500ms
Type "swale"  Sleep 400ms  Enter
Sleep 3s

# The palette filters as you type; enter runs the highlighted command.
Type "/"
Sleep 1.4s
Type "su"
Sleep 1s
Enter
Sleep 14s

Type "show me my leetcode calendar"
Sleep 500ms
Enter
Sleep 16s
Sleep 2s
