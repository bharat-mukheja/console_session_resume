# Route the normal startup sequence through these wrappers without editing dotfiles.
typeset -g __csr_wrapper_zdotdir=$ZDOTDIR
typeset -g __csr_user_zdotdir=$CSR_ORIGINAL_ZDOTDIR
ZDOTDIR=$__csr_user_zdotdir
[[ ! -r $__csr_user_zdotdir/.zshenv ]] || source "$__csr_user_zdotdir/.zshenv"
# The user's .zshenv may choose a different directory for the remaining files.
__csr_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__csr_wrapper_zdotdir
HISTFILE=$CSR_HISTORY_FILE
