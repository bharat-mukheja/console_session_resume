# This file is loaded only by managed interactive Bash terminals.
# It does not modify the user's startup files or global history.
[[ $- == *i* ]] || return

# Keep a private copy in case startup files change exported variables.
__csr_history_file=$CSR_HISTORY_FILE
__csr_session_dir=$CSR_SESSION_DIR
__csr_history_size=$CSR_HISTORY_SIZE
__csr_integration_script=$CSR_INTEGRATION_SCRIPT

if [[ $CSR_STARTUP_MODE == login ]]; then
    [[ ! -r /etc/profile ]] || source /etc/profile
    if [[ -r $HOME/.bash_profile ]]; then
        source "$HOME/.bash_profile"
    elif [[ -r $HOME/.bash_login ]]; then
        source "$HOME/.bash_login"
    elif [[ -r $HOME/.profile ]]; then
        source "$HOME/.profile"
    fi
else
    [[ ! -r $HOME/.bashrc ]] || source "$HOME/.bashrc"
fi

if [[ ! -f $__csr_history_file || ! -w $__csr_history_file || ! -d $__csr_session_dir ]]; then
    printf 'Session Resume: history storage is unavailable; history saving is disabled.\n' >&2
    unset HISTFILE
    return
fi

export HISTFILE=$__csr_history_file
{ printf '%s\n' "$$"; LC_ALL=C command ps -p "$$" -o lstart=; } > "$__csr_session_dir/process" 2>/dev/null
HISTSIZE=$__csr_history_size
HISTFILESIZE=$__csr_history_size
# This history belongs to one terminal, so a full snapshot also works on older
# macOS Bash versions whose history -a does not save an initially empty history.
shopt -u histappend
shopt -s cmdhist
# Setting this even to empty makes Bash store timestamps, delimiting multiline entries.
HISTTIMEFORMAT=${HISTTIMEFORMAT-}
# Startup hooks may have imported shared history. Bash loads HISTFILE after this rc file.
builtin history -c

__csr_save_history() {
    local __csr_status=$?
    HISTFILE=$__csr_history_file
    (umask 077; builtin history -w "$__csr_history_file.tmp.$$") &&
        command mv -f -- "$__csr_history_file.tmp.$$" "$__csr_history_file"
    printf '%s' "$PWD" > "$__csr_session_dir/cwd"
    return "$__csr_status"
}

# Let Bash evaluate existing prompt hooks in its normal way and retain their exit status.
if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == 'declare -a '* ]]; then
    PROMPT_COMMAND=(__csr_save_history "${PROMPT_COMMAND[@]}")
else
    PROMPT_COMMAND="__csr_save_history${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi

# Custom --init-file args prevent automatic injection, so load VS Code's own script.
# Avoid asking it to source startup files for a second time.
if [[ -n $__csr_integration_script && -r $__csr_integration_script && -z ${VSCODE_SHELL_INTEGRATION-} ]]; then
    unset VSCODE_INJECTION VSCODE_SHELL_LOGIN
    source "$__csr_integration_script"
fi
