# 0.3.0 validation

Validated November 14, 2026, at source commit
`964ac69e10a84e761e0979b41daf25ec7d7d323f`.

Evidence: [GitHub Actions run 43601526055](https://github.com/bharat-mukheja/console_session_resume/actions/runs/43601526055).
All seven jobs passed. The native jobs attach only their validation/result JSON;
actual histories and shell homes are excluded from artifacts.

| Check | Result |
| --- | --- |
| Unit tests and official VSIX packaging on Windows/macOS/Linux | All passed; 16 unit tests per host |
| Native Windows, VS Code 1.146.0 | Create/split, restart recovery, Bash/pwsh/powershell adapters, resume UX passed |
| Native Linux, VS Code 1.146.0 | Create/split, automatic revival, Bash/Zsh/Fish/pwsh adapters, resume UX passed |
| Native Linux, minimum VS Code 1.93.0 | Same history/recovery checks passed; rich shell integration is optional |
| Native macOS, VS Code 1.146.0 | Create/split, automatic revival, Bash/Zsh/Fish/PowerShell adapters, resume UX passed |
| Public image URLs in packaged README | Icon and all three screenshots loaded anonymously over HTTPS |
| Publisher migration | Import, preserved originals, current history on adoption, interrupted-copy retry, active-process fingerprint checks passed |

The Windows restart result explicitly recorded `automaticRevival: false` and
`savedSessionRecovery: true`: the original histories were recovered using the same
controller action exposed by Saved Terminals. Linux and macOS recorded automatic
revival in this final run. Earlier macOS runs also required recovery; do not promise
that VS Code always retains the launch environment.

A successful result does not mean the physical computer was rebooted. Tests end
shell/editor processes and reopen them from disk. Remote SSH, WSL and container
hosts have not been run in this matrix. Shell profiles and other history managers
can still affect behavior.

Screenshots came from a newly created `orbit-api` sample project in the dedicated
**Session Resume Screenshots** profile. The sample ran real commands. The original
existing user projects were not used as screenshot content.
