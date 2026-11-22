import { CircleDashed, Diamond, Hexagon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Keep the same quiet identity mark when an agent moves between surfaces. */
export function AgentMark({ id }: { id: string }) {
  const identity = Array.from(id).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % 3;
  const Icon = [CircleDashed, Hexagon, Diamond][identity] ?? CircleDashed;
  return <Icon aria-hidden strokeWidth={1.5} className={cn("size-4 shrink-0", ["text-violet-11", "text-amber-11", "text-cyan-11"][identity])} />;
}
