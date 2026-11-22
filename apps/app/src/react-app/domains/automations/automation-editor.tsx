/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react"
import { t } from "@/i18n";
import {
  AUTOMATION_CLOUD_DEFAULT_MODEL,
  AUTOMATION_FREE_MODEL,
  isAutomationCloudDefaultModel,
  type AutomationExecutionTarget,
  type CreateAutomation,
} from "@openwork/types/automations"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { IconImage } from "@/react-app/design-system/icon-image"
import { Cloud, Laptop } from "lucide-react"

import { AutomationScheduleFields, AutomationTimezoneField } from "./automation-schedule-fields"
import { AutomationModelButton } from "./automation-model-button"
import { ModelPickerModal } from "@/react-app/domains/session/modals/model-picker-modal"
import type { AutomationModelOption, AutomationProviderCatalog } from "./automation-model-options"
import { automationPickerOptions } from "./automation-model-options"

function localTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

function defaultInput(modelOptions: readonly AutomationModelOption[]): CreateAutomation {
  const first = modelOptions[0] ?? AUTOMATION_FREE_MODEL
  return {
    name: "",
    instructions: "",
    schedule: { kind: "daily", timezone: localTimezone(), hour: 9, minute: 0 },
    model: { providerId: first.providerId, modelId: first.modelId, variant: null },
  }
}

function modelKey(model: { providerId: string; modelId: string }) {
  return `${encodeURIComponent(model.providerId)}:${encodeURIComponent(model.modelId)}`
}

/** Keeps the chosen model when these options offer it; otherwise moves to the first one. */
function withAvailableModel(input: CreateAutomation, options: readonly AutomationModelOption[]): CreateAutomation {
  if (options.length === 0 || options.some((option) => modelKey(option) === modelKey(input.model))) return input
  return { ...input, model: defaultInput(options).model }
}


/** A Workflow version the Automation is pinned to instead of free-form instructions and a model. */
export type AutomationEditorPinnedWorkflow = {
  title: string
  configObjectVersionId: string
}

export type AutomationEditorProps = {
  /** Opens AI provider settings when the picker offers to connect more providers. */
  onOpenProviderSettings?: () => void
  initial?: CreateAutomation | null
  initialKey?: string
  /** Where the Automation runs unless the person picks the other of `placementChoices`. */
  placement: AutomationExecutionTarget
  /** Where it can run; with more than one "what it can use" choice, the person picks. */
  placementChoices?: readonly AutomationExecutionTarget[]
  /** What a cloud run can reach: a cloud computer's files, only connected accounts (headless), or both choices. */
  cloudOptions?: AutomationCloudOptions
  /** True in the desktop app, where the desktop choice means this very computer. */
  onThisComputer?: boolean
  /** The person's connected accounts, shown on every choice. */
  connectedAccounts?: readonly AutomationConnectedAccount[]
  pinnedWorkflow?: AutomationEditorPinnedWorkflow
  modelOptions: readonly AutomationModelOption[]
  /** Models each placement can use, when they differ; defaults to `modelOptions`. */
  modelOptionsByPlacement?: Readonly<Record<AutomationExecutionTarget, readonly AutomationModelOption[]>>
  providerCatalog?: AutomationProviderCatalog
  busy: boolean
  openModelPickerOnMount?: boolean
  submitLabel: string
  onCancel: () => void
  onSave: (input: CreateAutomation, placement: AutomationExecutionTarget) => Promise<void> | void
}

export type AutomationConnectedAccount = { id: string; name: string; iconUrl: string | null }

export type AutomationCloudOptions = {
  /** The person has an OpenWork Web computer, whose files a cloud run can use. */
  cloudComputer: boolean
  /** The headless runtime: runs that reach only connected accounts, on the organization's one model. */
  accountsOnly: boolean
}

/** What an Automation can use, which also decides where it runs. */
export type AutomationCanUse = "computer" | "cloud-computer" | "accounts"

const CAN_USE_ORDER: readonly AutomationCanUse[] = ["computer", "cloud-computer", "accounts"]

export function automationCanUseChoices(
  placementChoices: readonly AutomationExecutionTarget[],
  cloud: AutomationCloudOptions | undefined,
): AutomationCanUse[] {
  return CAN_USE_ORDER.filter((choice) => {
    if (choice === "computer") return placementChoices.includes("desktop")
    if (!placementChoices.includes("cloud")) return false
    // An older Den that cannot say which cloud it has still offers one cloud choice.
    if (!cloud) return choice === "cloud-computer"
    return choice === "cloud-computer" ? cloud.cloudComputer : cloud.accountsOnly
  })
}

export function automationPlacementOf(choice: AutomationCanUse): AutomationExecutionTarget {
  return choice === "computer" ? "desktop" : "cloud"
}

/** The words for each choice say what the Automation can reach, not where it runs. */
export function automationCanUseLabel(choice: AutomationCanUse, onThisComputer?: boolean) {
  if (choice === "computer") return onThisComputer ? t("secondary_ui.automations.editor.use_this_computer") : t("secondary_ui.automations.editor.use_your_computer")
  if (choice === "cloud-computer") return t("secondary_ui.automations.editor.use_cloud_computer")
  return t("secondary_ui.automations.editor.use_accounts")
}

export function automationCanUseNote(choice: AutomationCanUse) {
  if (choice === "computer") return t("secondary_ui.automations.editor.note_computer")
  if (choice === "cloud-computer") return t("secondary_ui.automations.den.cloud_hint")
  return t("secondary_ui.automations.editor.note_accounts")
}

/** Where an Automation starts: its placement, then the cloud it uses (the cloud default model means only accounts). */
export function initialCanUse(
  placement: AutomationExecutionTarget,
  model: CreateAutomation["model"] | undefined,
  choices: readonly AutomationCanUse[],
): AutomationCanUse {
  if (placement === "desktop") return "computer"
  if (model && isAutomationCloudDefaultModel(model) && choices.includes("accounts")) return "accounts"
  if (choices.includes("cloud-computer")) return "cloud-computer"
  return choices.includes("accounts") ? "accounts" : "cloud-computer"
}

const LOGO_TILE = "grid size-5 place-items-center overflow-hidden rounded-md border border-border bg-background"

/**
 * What a choice can reach, at a glance: the computer whose files it can use
 * (when it can), plus the logos of the person's connected accounts.
 */
function ConnectedAccountLogos({ accounts, files }: { accounts: readonly AutomationConnectedAccount[]; files?: "computer" | "cloud-computer" }) {
  const shown = accounts.slice(0, 4)
  const names = accounts.map((account) => account.name)
  const accountsLabel = names.length > 3 ? t("secondary_ui.automations.editor.accounts_more", { names: names.slice(0, 3).join(", "), count: names.length - 3 }) : names.join(", ")
  const filesLabel = files === "computer" ? t("secondary_ui.automations.editor.files_computer") : files === "cloud-computer" ? t("secondary_ui.automations.editor.files_cloud") : null
  const label = [filesLabel, accountsLabel].filter(Boolean).join(t("secondary_ui.automations.editor.plus_joiner"))
  if (!filesLabel && accounts.length === 0) return <span className="text-xs text-muted-foreground">{t("secondary_ui.automations.editor.none_connected")}</span>
  return (
    <span className="flex shrink-0 items-center gap-1.5" aria-label={label} title={label} data-automation-connected-accounts={accounts.length}>
      {files ? (
        <>
          <span className={`${LOGO_TILE} text-muted-foreground`} data-automation-files={files}>
            {files === "computer" ? <Laptop size={13} strokeWidth={1.5} aria-hidden /> : <Cloud size={13} strokeWidth={1.5} aria-hidden />}
          </span>
          {accounts.length > 0 ? <span aria-hidden className="text-xs text-muted-foreground">+</span> : null}
        </>
      ) : null}
      <span className="flex gap-1">
        {shown.map((account) => (
          <span key={account.id} className={LOGO_TILE}>
            <IconImage
              src={account.iconUrl}
              size={14}
              fallback={<span className="text-[10px] font-medium text-muted-foreground">{account.name.charAt(0).toUpperCase()}</span>}
            />
          </span>
        ))}
      </span>
      {accounts.length > shown.length ? <span className="text-xs text-muted-foreground">+{accounts.length - shown.length}</span> : null}
    </span>
  )
}

export function AutomationEditor(props: AutomationEditorProps) {
  const choices = automationCanUseChoices(props.placementChoices ?? [], props.cloudOptions)
  const canChoose = choices.length > 1
  const [chosen, setChosen] = useState<AutomationCanUse | null>(null)
  const fallbackChoice = initialCanUse(props.placement, props.initial?.model, choices)
  const canUse = canChoose && chosen && choices.includes(chosen) ? chosen : fallbackChoice
  const placement = canChoose ? automationPlacementOf(canUse) : props.placement
  // "Only connected accounts" runs on the organization's one cloud model: there is nothing to pick.
  const usesCloudDefault = canUse === "accounts"
  const modelOptions = props.modelOptionsByPlacement?.[placement] ?? props.modelOptions
  const [input, setInput] = useState<CreateAutomation>(() => {
    const start = props.initial ?? defaultInput(modelOptions)
    return usesCloudDefault ? { ...start, model: { ...AUTOMATION_CLOUD_DEFAULT_MODEL, variant: null } } : start
  })
  const [pickerOpen, setPickerOpen] = useState(props.openModelPickerOnMount === true)
  const appliedInitialKey = useRef(props.initialKey)

  useEffect(() => {
    if (props.initial) {
      if (appliedInitialKey.current === props.initialKey) return
      appliedInitialKey.current = props.initialKey
      setInput(props.initial)
      return
    }
    // Creating: keep what the person typed; move only off a model this
    // choice cannot use (models and choices load late, or the choice changed).
    setInput((current) => {
      if (!usesCloudDefault) return withAvailableModel(current, modelOptions)
      return isAutomationCloudDefaultModel(current.model) ? current : { ...current, model: { ...AUTOMATION_CLOUD_DEFAULT_MODEL, variant: null } }
    })
  }, [modelOptions, props.initial, props.initialKey, usesCloudDefault])

  useEffect(() => {
    if (props.openModelPickerOnMount) setPickerOpen(true)
  }, [props.openModelPickerOnMount])

  const [modelQuery, setModelQuery] = useState("")
  const selectedModel = modelKey(input.model)
  const currentModelAvailable = usesCloudDefault || modelOptions.some((option) => modelKey(option) === selectedModel)
  const pickerOptions = useMemo(
    () => automationPickerOptions({
      options: modelOptions,
      catalog: props.providerCatalog ?? {},
      selected: input.model,
    }),
    [input.model, modelOptions, props.providerCatalog],
  )
  const pinnedWorkflow = props.pinnedWorkflow
  const cloud = placement === "cloud"

  const chooseCanUse = (next: AutomationCanUse) => {
    setChosen(next)
    if (next === "accounts") {
      setInput((current) => ({ ...current, model: { ...AUTOMATION_CLOUD_DEFAULT_MODEL, variant: null } }))
      return
    }
    // The free starter model runs only on a desktop, and the cloud default only
    // headless: keep the model when the new choice offers it, otherwise switch
    // visibly to one it does.
    const options = props.modelOptionsByPlacement?.[automationPlacementOf(next)] ?? props.modelOptions
    setInput((current) => withAvailableModel(current, options))
  }
  // Den reads the calendar for these, so they run only in OpenWork Cloud.
  const meetingsNeedCloud = input.schedule.kind === "calendar" && placement !== "cloud"
  const canSave = useMemo(
    () => input.name.trim().length > 0
      && !meetingsNeedCloud
      && (pinnedWorkflow !== undefined || (input.instructions.trim().length > 0 && currentModelAvailable)),
    [currentModelAvailable, input.instructions, input.name, meetingsNeedCloud, pinnedWorkflow],
  )
  return (
    <form
      className="space-y-5"
      data-automation-editor
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave && !props.busy) void props.onSave(input, placement)
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="automation-name">{t("extensions.add_name_label")}</Label>
        <Input
          id="automation-name"
          value={input.name}
          maxLength={120}
          required
          placeholder={t("secondary_ui.automations.editor.name_placeholder")}
          onChange={(event) => {
            const name = event.currentTarget.value
            setInput((current) => ({ ...current, name }))
          }}
        />
      </div>

      {pinnedWorkflow ? (
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm" data-automation-pinned-workflow={pinnedWorkflow.configObjectVersionId}>
          <p className="font-medium">{t("secondary_ui.automations.editor.pinned_workflow")}</p>
          <p className="mt-1 text-muted-foreground">{pinnedWorkflow.title}</p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{t("secondary_ui.automations.editor.version", { version: pinnedWorkflow.configObjectVersionId })}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="automation-instructions">{t("extensions.add_instructions_label")}</Label>
          <Textarea
            id="automation-instructions"
            className="min-h-36 resize-y"
            value={input.instructions}
            required
            placeholder={t("secondary_ui.automations.editor.instructions_placeholder")}
            onChange={(event) => {
              const instructions = event.currentTarget.value
              setInput((current) => ({ ...current, instructions }))
            }}
          />
          <p className="text-xs text-muted-foreground">{cloud
            ? canUse === "accounts" ? t("secondary_ui.automations.editor.fresh_cloud") : t("secondary_ui.automations.editor.new_task_cloud")
            : t("secondary_ui.automations.editor.new_task_desktop")}</p>
        </div>
      )}

      <AutomationScheduleFields
        schedule={input.schedule}
        onChange={(schedule) => setInput((current) => ({ ...current, schedule }))}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <AutomationTimezoneField
          timezone={input.schedule.timezone}
          onChange={(timezone) => setInput((current) => ({ ...current, schedule: { ...current.schedule, timezone } }))}
        />
        {pinnedWorkflow || usesCloudDefault ? null : <div className="space-y-2">
          <Label htmlFor="automation-model">{t("extensions.detail_fact_model")}</Label>
          <AutomationModelButton id="automation-model" model={input.model} options={modelOptions} onClick={() => setPickerOpen(true)} />
          <ModelPickerModal
            open={pickerOpen}
            options={pickerOptions}
            query={modelQuery}
            setQuery={setModelQuery}
            subtitle={cloud ? t("secondary_ui.automations.editor.model_cloud") : t("secondary_ui.automations.editor.model_desktop")}
            target="default"
            current={{ providerID: input.model.providerId, modelID: input.model.modelId }}
            onSelect={(model) => {
              setInput((current) => ({
                ...current,
                model: {
                  providerId: model.providerID,
                  modelId: model.modelID,
                  variant: current.model.providerId === model.providerID && current.model.modelId === model.modelID
                    ? current.model.variant : null,
                },
              }))
              setPickerOpen(false)
            }}
            onBehaviorChange={(model, variant) => setInput((current) => ({
              ...current,
              model: { providerId: model.providerID, modelId: model.modelID, variant },
            }))}
            onOpenSettings={() => { setPickerOpen(false); props.onOpenProviderSettings?.() }}
            onOpenProviderSettings={props.onOpenProviderSettings}
            onClose={() => setPickerOpen(false)}
          />
        </div>}
      </div>

      {canChoose ? (
        <div className="space-y-2">
          <Label id="automation-can-use">{t("secondary_ui.automations.editor.can_use")}</Label>
          <RadioGroup
            aria-labelledby="automation-can-use"
            data-automation-runs-on={placement}
            data-automation-can-use={canUse}
            value={canUse}
            onValueChange={(next) => {
              const match = choices.find((choice) => choice === next)
              if (match) chooseCanUse(match)
            }}
            className="gap-0 overflow-hidden rounded-xl border border-border"
          >
            {choices.map((choice) => (
              <label
                key={choice}
                className="flex min-h-11 cursor-pointer items-center gap-3 border-border px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-muted/40 has-[[data-checked]]:bg-muted/50 [&:not(:first-child)]:border-t"
              >
                <RadioGroupItem value={choice} />
                <span className="min-w-0 flex-1">{automationCanUseLabel(choice, props.onThisComputer)}</span>
                <ConnectedAccountLogos
                  accounts={props.connectedAccounts ?? []}
                  files={choice === "computer" ? "computer" : choice === "cloud-computer" ? "cloud-computer" : undefined}
                />
              </label>
            ))}
          </RadioGroup>
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground" data-automation-placement={placement}>
        {meetingsNeedCloud
          ? t("secondary_ui.automations.editor.meetings_need_cloud")
          : automationCanUseNote(canChoose ? canUse : props.placement === "desktop" ? "computer" : fallbackChoice)}
      </p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={props.busy} onClick={props.onCancel}>{t("common.cancel")}</Button>
        <Button type="submit" disabled={!canSave || props.busy}>{props.busy ? t("settings.environment.saving") : props.submitLabel}</Button>
      </div>
    </form>
  )
}
