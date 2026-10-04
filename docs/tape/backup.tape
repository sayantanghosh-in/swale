# Moving swale to another machine.

Output docs/images/backup.gif
Source docs/tape/_settings.tape

Set Height 440

Hide
Type "export SWALE_DATA_DIR=/tmp/swale-demo"  Enter
Type "export PS1='\033[38;5;208m❯\033[0m '"  Enter
Type "clear"  Enter
Show

Sleep 500ms
Type "swale backup /tmp"  Sleep 300ms  Enter
Sleep 3.5s

Type "export SWALE_DATA_DIR=/tmp/swale-newmachine"  Sleep 200ms  Enter
Sleep 600ms
Type "swale restore /tmp/swale-backup-*.zip"  Sleep 300ms  Enter
Sleep 4.5s
