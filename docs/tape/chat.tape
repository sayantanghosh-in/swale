# Runs against whatever model is configured locally. With Ollama this is a real
# response, streamed, not a scripted one.

Output docs/images/chat.gif
Source docs/tape/_settings.tape

Set Height 400

Hide
Type "export SWALE_DATA_DIR=/tmp/swale-demo"  Enter
Type "export PS1='\033[38;5;208m❯\033[0m '"  Enter
Type "clear"  Enter
Show

Sleep 500ms
Type "swale chat"  Sleep 300ms  Enter
Sleep 1.4s
Type "In one sentence: what is a git rebase?"
Sleep 400ms
Enter
Sleep 10s
