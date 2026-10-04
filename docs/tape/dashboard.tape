# The hero recording: the dashboard, and the agent working from real data.
#
# `swale` with no arguments is the whole product on one screen, so this is the
# tape that goes at the top of the README.

Output docs/images/dashboard.gif
Source docs/tape/_settings.tape

# Taller than the default so the mark survives two exchanges.
Set Height 1000

Hide
Type "export SWALE_DATA_DIR=/tmp/swale-demo"  Enter
Type "export PS1='\033[38;5;208m❯\033[0m '"  Enter
Type "clear"  Enter
Show

Sleep 500ms
Type "swale"  Sleep 400ms  Enter

# Two network calls have to land before it can draw.
Sleep 5s

Type "what have I got left to do?"
Sleep 600ms
Enter
Sleep 15s

Type "mark the eval cases one done"
Sleep 600ms
Enter
Sleep 15s

Sleep 2s
