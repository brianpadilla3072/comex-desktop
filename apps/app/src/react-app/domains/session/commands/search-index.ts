import fuzzysort from "fuzzysort";
import type { ComposerSlashCommandOption } from "../surface/composer/slash-command";
/** Prepared once per catalog revision, not on each keystroke or streamed token. */
export function indexSlashOptions(options: readonly ComposerSlashCommandOption[]) {
  return options.map(option => ({ option, name: fuzzysort.prepare(option.name), description: fuzzysort.prepare(option.description ?? ""), label: fuzzysort.prepare(option.label ?? ""), aliases: fuzzysort.prepare(option.searchText ?? "") }));
}
export function searchSlashOptions(query: string, index: ReturnType<typeof indexSlashOptions>, limit = 24) {
  return fuzzysort.go(query, index, { keys: ["name", "description", "label", "aliases"], limit }).map(entry => entry.obj.option);
}
