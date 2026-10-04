# `swale chat` is the same agent as the dashboard, without the dashboard.
# Runs against whatever model is configured locally, so the reply is real.

Output docs/images/chat.gif
Source docs/tape/_settings.tape

Set Height 520

Hide
Type "export SWALE_DATA_DIR=/tmp/swale-demo"  Enter
Type "export PS1='\033[38;5;208m❯\033[0m '"  Enter
Type "clear"  Enter
Show

Sleep 500ms
Type "swale chat"  Sleep 300ms  Enter
Sleep 1.4s
Type "how much have I spent this month?"
Sleep 400ms
Enter
Sleep 14s
Type "and what is still on my todo list?"
Sleep 400ms
Enter
Sleep 15s
