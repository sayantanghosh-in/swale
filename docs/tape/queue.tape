# Prompts queue while the agent works, and esc stops the one in flight.

Output docs/images/queue.gif
Source docs/tape/_settings.tape

Set Height 1000

Hide
Type "export SWALE_DATA_DIR=/tmp/swale-demo"  Enter
Type "export PS1='\033[38;5;208m❯\033[0m '"  Enter
Type "clear"  Enter
Show

Sleep 400ms
Type "swale"  Sleep 300ms  Enter
Sleep 5s

Type "list my three most recent repositories"
Sleep 400ms
Enter
Sleep 2.5s

# Typing carries on while the first one runs; this one waits its turn.
Type "how much have I spent this month?"
Sleep 400ms
Enter
Sleep 4s

# Stop the one in flight. The queued prompt is picked up straight after.
Escape
Sleep 14s
Sleep 2s
