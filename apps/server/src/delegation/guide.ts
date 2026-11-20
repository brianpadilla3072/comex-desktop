/**
 * The procedure the agent follows to learn a new external agent CLI. Served by
 * the delegate_guide tool and summarized in the MCP server instructions, so it
 * travels with the feature instead of depending on a skill being installed.
 */
export const DELEGATION_INSTRUCTIONS = [
  "Delegate tasks to other agents' command-line tools (or any CLI) that run on this computer.",
  "To learn a tool you have not registered, call delegate_guide and follow it: inspect the help with delegate_probe, use term_* for sign-in or first-run wizards, then delegate_register a tested recipe.",
  "Registered tools: delegate_list. Run work with delegate_start, follow it with delegate_status/delegate_result, answer its permission requests and questions with delegate_reply, and stop it with delegate_cancel.",
].join(" ");

export const DELEGATION_GUIDE = `# Learn and use an external agent CLI

Goal: turn "use <tool>" into a tested, registered recipe, then delegate work to it.
Everything runs locally. Never sign the person into a website account for them and
never invent flags: every flag in a recipe must come from the tool's own help or docs.

## 1. Find it
- delegate_list: is it already registered? If yes, go to step 6.
- delegate_probe ["<tool>", "--version"] (or "-v", "version"). Not found: tell the person
  how the vendor says to install it and stop until they confirm it is installed. Do not
  pipe install scripts yourself.

## 2. Read the help
- delegate_probe ["<tool>", "--help"], then "help <subcommand>" / "<subcommand> --help"
  for anything about running a prompt, output formats, permissions, sessions and login.
- If the help is thin, read the official docs with your web tools.
- Look for:
  - an ACP mode (Agent Client Protocol over stdio): a subcommand or flag such as "acp", "--acp"
    or "--experimental-acp". It is the best way to delegate: permissions and questions come
    back to you as structured requests and the session stays open for follow-ups;
  - a non-interactive mode that takes one prompt and exits (often -p/--print, exec, run, ask);
  - machine-readable output (--output-format json/stream-json/jsonl, --json);
  - a way to continue a session (--resume <id>, -r, --continue) and where the id appears;
  - how it asks for permission to edit files or run commands, and the flag that makes
    it act without stopping (it will run in an isolated git worktree);
  - how it authenticates (login command, API key environment variable).

## 3. Sign-in and first run
- If a login or a first-run wizard is required, open it with term_open ["<tool>", "login"]
  (or just ["<tool>"]), read it with term_read, answer with term_send, wait with term_wait.
- Codes, passwords and API keys come from the person. Ask them; never guess, never store
  them in a recipe, and never paste them anywhere except the tool's own prompt.
- If the tool prints a URL to open, give it to the person and wait for them.
- Close the terminal with term_close when done.

## 4. Test a real run
- ACP: you cannot probe it with one command (it waits for messages). Register it as kind "acp"
  and test it with delegate_start { prompt: "Reply with the single word OK" } and delegate_result.
- Otherwise delegate_probe the exact non-interactive command with a trivial task, e.g.
  ["<tool>", "-p", "Reply with the single word OK"], with a timeout of 120 s.
- Check the exit code and that the answer is in stdout. For JSON output, find the field
  that holds the final answer and the one that holds the session id.
- Fix flags and repeat until it works. If it only works interactively, plan a pty recipe.

## 5. Register the recipe
delegate_register with:
- name: short lowercase id ("devin", "codex", "aider").
- kind: "acp" when it has an ACP mode (preferred): command is just the ACP command, e.g.
  ["<tool>", "acp"], no {prompt}. acpMode picks a session mode (its normal editing mode, never one
  that approves everything). permissions sets who answers its requests, by tool kind
  (read, edit, delete, move, search, execute, think, fetch, switch_mode, other): allow, agent
  (you decide), person, deny. The defaults allow reading and editing, let you decide commands and
  deletions, and send network fetches to the person. Risky requests always go to the person.
- kind: "cli" when only a one-shot mode works; "pty" when it must be driven in a terminal.
- command: argv with {prompt} where the task goes (prompt: "arg"), or prompt: "stdin".
- output: "jsonl" plus resultField/sessionIdField when it prints JSON lines, else "text".
- resume: argv with {sessionId} (and {prompt}) when it can continue a session.
- pty only: readyText (shown when it waits for input), doneText (shown when it finished),
  idleSeconds.
- versionCommand: e.g. ["<tool>", "--version"], so upgrades are noticed.
- notes: what you learned that is not obvious (needs login first, flag X avoids a prompt).
The person approves the registration.

## 6. Delegate
- delegate_start { agent, prompt }: write a complete, self-contained task (goal, files,
  constraints, how to verify, what to report back). The external agent does not see this chat.
- When delegate_result or delegate_status shows state needs_input, the agent waits for you:
  - pendingInput.type permission: decide with delegate_reply. Allow what the task you gave
    needs inside the task folder (running its tests, a build, editing project files); reject
    what it does not need; use ask_person when you are unsure or it touches anything outside.
  - pendingInput.type question: answer with delegate_reply text, or decision done if it already
    finished and only waits at a prompt.
  - pendingInput.reason risky_command or outside_folder marks something sensitive (network,
    privileges, publishing, files outside the task folder). Usually the person decides these;
    when the person chose to let you decide, they reach you instead: allow them only if the
    task clearly needs it (e.g. downloading a dependency the task asked for), otherwise reject.
  Never approve everything blindly, and never answer for the person what only they can know
  (accounts, money, credentials, product decisions): ask them.
- After the agent finishes a turn (ACP or terminal), the session stays open: send follow-ups with
  delegate_reply text, then delegate_result again.
- By default it works in an isolated git worktree. delegate_result returns its answer,
  the changed files and the worktree path; review the diff there before bringing changes
  into the project (git merge/cherry-pick/apply), then delegate_discard to remove the copy.
- Long runs: poll delegate_status / delegate_result with waitSeconds. For pty runs you can
  watch and answer it through term_read/term_send with the task's terminalId.
- If delegate_list marks a tool as needing a check (new version or missing), repeat steps 2-5.
`;
