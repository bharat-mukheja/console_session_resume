ZDOTDIR=$__csr_user_zdotdir
[[ ! -r $ZDOTDIR/.zshrc ]] || source "$ZDOTDIR/.zshrc"
__csr_user_zdotdir=$ZDOTDIR
# Use a fresh history context in case a plugin loaded shared history during startup.
fc -p
HISTFILE=$CSR_HISTORY_FILE
{ printf '%s\n' "$$"; LC_ALL=C command ps -p "$$" -o lstart=; } > "$CSR_SESSION_DIR/process" 2>/dev/null
HISTSIZE=$CSR_HISTORY_SIZE
SAVEHIST=$CSR_HISTORY_SIZE
setopt APPEND_HISTORY INC_APPEND_HISTORY
unsetopt SHARE_HISTORY INC_APPEND_HISTORY_TIME
__csr_save_cwd() { printf '%s' "$PWD" > "$CSR_SESSION_DIR/cwd" }
autoload -Uz add-zsh-hook
add-zsh-hook precmd __csr_save_cwd
if [[ -n $CSR_INTEGRATION_SCRIPT && -r $CSR_INTEGRATION_SCRIPT ]]; then
    source "$CSR_INTEGRATION_SCRIPT"
fi
if [[ -o login ]]; then
    ZDOTDIR=$__csr_wrapper_zdotdir
fi
