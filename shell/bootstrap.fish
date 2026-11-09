# fish_history is also set in the launch environment, before user config loads.
set -gx fish_history $CSR_FISH_HISTORY
begin
    printf '%s\n' $fish_pid
    env LC_ALL=C ps -p $fish_pid -o lstart=
end > "$CSR_SESSION_DIR/process" 2>/dev/null
function __csr_save_history --on-event fish_prompt
    history save
    printf '%s' "$PWD" > "$CSR_SESSION_DIR/cwd"
end
function __csr_save_before_command --on-event fish_preexec
    history save
end
if test -n "$CSR_INTEGRATION_SCRIPT"; and test -r "$CSR_INTEGRATION_SCRIPT"
    source "$CSR_INTEGRATION_SCRIPT"
end
