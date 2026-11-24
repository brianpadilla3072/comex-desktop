import fuzzysort from "fuzzysort";
import type { ComposerSlashCommandOption } from "../surface/composer/slash-command";
/** Prepared once per catalog revision, not on each keystroke or streamed token. */
export function indexSlashOptions(options: readonly ComposerSlashCommandOption[]) {
  return options.map(option => ({ option, name: fuzzysort.prepare(option.name), description: fuzzysort.prepare(option.description ?? ""), label: fuzzysort.prepare(option.label ?? ""), aliases: fuzzysort.prepare(option.searchText ?? "") }));
}
/** No row cap: every OpenCode command the engine reports stays reachable. Search narrows the list. */
export function searchSlashOptions(query: string, index: ReturnType<typeof indexSlashOptions>, limit = index.length) {
  return fuzzysort.go(query, index, { keys: ["name", "description", "label", "aliases"], limit }).map(entry => entry.obj.option);
}

/** The whole merged catalog when idle, every match when searching. */
export function filterSlashOptions(query: string, options: readonly ComposerSlashCommandOption[], index = indexSlashOptions(options)) {
  return query.trim() ? searchSlashOptions(query, index) : [...options];
}
