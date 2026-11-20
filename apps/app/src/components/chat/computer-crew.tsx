import { useEffect, useState } from "react"
import { replaceEqualDeep } from "@tanstack/react-query"
import type { ComputerCrewMember } from "@openwork/types/desktop-ipc"

import { desktopBridge } from "@/app/lib/desktop"
import { t } from "@/i18n"
import { Button } from "@/components/ui/button"

const POLL_MS = 1_500

/** Locale keys of each agent's state; translated when shown. */
const STATES: Record<ComputerCrewMember["state"], string> = {
  working: "secondary_ui.computer.crew_working",
  waiting: "secondary_ui.computer.crew_waiting",
  paused: "secondary_ui.computer.crew_paused",
  done: "secondary_ui.computer.crew_done",
}

/**
 * While `enabled`, the chat's subagents on its computer (`parallelComputerUse`), read from the
 * desktop with a live frame of each agent's app. Leaving stops the frames.
 */
export function useComputerCrew(sessionId: string, enabled: boolean): ComputerCrewMember[] {
  const [members, setMembers] = useState<ComputerCrewMember[]>([])
  useEffect(() => {
    if (!enabled) { setMembers(previous => previous.length ? [] : previous); return }
    let current = true
    const read = () => {
      if (document.visibilityState !== "visible") return
      // The same crew keeps its array, so the chat around it does not re-render on every poll.
      void desktopBridge.computerCrew(sessionId, true).then(next => { if (current) setMembers(previous => replaceEqualDeep(previous, next)) }, () => {})
    }
    read()
    const timer = window.setInterval(read, POLL_MS)
    return () => {
      current = false
      window.clearInterval(timer)
      void desktopBridge.computerCrew(sessionId, false).catch(() => {})
    }
  }, [sessionId, enabled])
  return members
}

/** One row per agent: its cursor's name and color, app, state and latest step; a row opens its live view. */
export function ComputerCrew({ members, onOpen }: { members: readonly ComputerCrewMember[]; onOpen: (member: ComputerCrewMember) => void }) {
  if (!members.length) return null
  return (
    <ul data-computer-crew="" aria-label={t("secondary_ui.computer.crew_aria")} className="space-y-1 border-t border-border px-1 py-1">
      {members.map(member => <li key={member.sessionId}>
        <Button variant="ghost" data-computer-crew-member={member.state} aria-label={t("secondary_ui.computer.crew_watch", { name: member.name })}
          className="h-auto w-full min-w-0 justify-start gap-3 px-2 py-1.5 text-left" onClick={() => onOpen(member)}>
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: member.color }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{member.name}{member.app ? <span className="font-normal text-muted-foreground"> · {member.app}</span> : null}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              <span data-computer-crew-state="">{t(STATES[member.state])}</span>{member.intent && member.state !== "done" ? <> · {member.intent}</> : null}
            </span>
          </span>
          {member.frame ? <img src={`data:${member.frame.mimeType};base64,${member.frame.data}`} alt="" className="h-10 w-16 shrink-0 rounded object-contain" decoding="async" /> : null}
        </Button>
      </li>)}
    </ul>
  )
}

/** The crew alone, for a chat whose own turn used no computer steps. */
export function ComputerCrewCard({ members, onOpen }: { members: readonly ComputerCrewMember[]; onOpen: (member: ComputerCrewMember) => void }) {
  if (!members.length) return null
  return (
    <div data-computer-crew-card="" role="group" aria-label={t("secondary_ui.computer.crew_aria")} className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-background">
      <p className="px-3 pt-3 pb-2 text-sm font-medium">{members.some(member => member.state !== "done") ? t("secondary_ui.computer.crew_using") : t("secondary_ui.computer.crew_used")}</p>
      <ComputerCrew members={members} onOpen={onOpen} />
    </div>
  )
}
