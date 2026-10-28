# Blocks

This is an independent web application. Work in this folder; changes to sibling games require explicit user scope. Preserve the current public origin, manifest identity and IndexedDB compatibility.

Use headless browser tests only. Close browsers and test servers in finally. Heavy local checks run one at a time on one low-priority core with `taskset -c 15 nice -n 10`. Never leave test audio/processes running.

On this Linux workstation, run browser/release jobs in a separate user scope with `systemd-run --user --scope --quiet --property=MemoryMax=2G --property=MemorySwapMax=0`, keeping the CPU limits above. A previous terminal group was killed under memory pressure; CPU affinity alone does not bound memory. Binary release checks must use `Buffer.equals` with short diagnostics, never an assertion that prints a full binary diff.

Keep game rules, generation, scoring and save validation independent of React. Preserve full active board snapshots and statistics. Every new tray must have a verified complete placement sequence, including intermediate clears. Undo cannot rewind milestone claims.

Run the unit suite, build and relevant browser checks after functional changes. No music, whole-page zoom, sibling imports or scrollable app UI. Maintain readable system typography, reduced motion and keyboard focus. No paid services, accounts, ads or analytics. Do not publish to GitHub unless the user requests it.
