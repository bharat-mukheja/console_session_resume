ZDOTDIR=$__csr_user_zdotdir
[[ ! -r $ZDOTDIR/.zprofile ]] || source "$ZDOTDIR/.zprofile"
__csr_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__csr_wrapper_zdotdir
