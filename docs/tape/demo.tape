# The hero recording for the top of the README.
# Keeps to the core loop plus the headline integration; the per-feature tapes
# cover the rest so this one stays short enough to watch.

Output docs/images/demo.gif
Source docs/tape/_settings.tape

Hide
Type "export SWALE_DATA_DIR=/tmp/swale-demo"  Enter
Type "export PS1='\033[38;5;208m❯\033[0m '"  Enter
Type "clear"  Enter
Show

Sleep 600ms

Type "swale todo add"  Sleep 300ms  Enter
Sleep 1.2s
Type "Ship the v0.2.0 release notes"
Sleep 400ms
Enter
Sleep 1.6s

Type "swale todo list"  Sleep 300ms  Enter
Sleep 2.6s

Type "clear"  Enter
Sleep 300ms

Type "swale gh sync -n 3"  Sleep 300ms  Enter
Sleep 4s
