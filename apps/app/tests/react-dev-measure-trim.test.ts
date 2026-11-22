import { expect, test } from "bun:test"

import { REACT_DEV_MEASURE_TRIM_MS, startReactDevMeasureTrim } from "../src/react-app/infra/react-dev-measure-trim"

type Entry = { name: string }

function harness() {
  const buffer: Entry[] = []
  const observers: Array<(list: { getEntries(): readonly Entry[] }) => void> = []
  let observedWith: { type: string; buffered?: boolean } | null = null
  let disconnected = false
  let tick: (() => void) | null = null
  let interval = 0
  const performance = {
    clearMeasures(name?: string) {
      for (let index = buffer.length - 1; index >= 0; index -= 1) if (name === undefined || buffer[index].name === name) buffer.splice(index, 1)
    },
  }
  class Observer {
    constructor(private callback: (list: { getEntries(): readonly Entry[] }) => void) {}
    observe(options: { type: string; buffered?: boolean }) {
      observedWith = options
      observers.push(this.callback)
      if (options.buffered) this.callback({ getEntries: () => [...buffer] })
    }
    disconnect() { disconnected = true }
  }
  const scheduler = {
    setInterval(callback: () => void, ms: number) { tick = callback; interval = ms; return 1 },
    clearInterval() { tick = null },
  }
  // Like the browser: an entry lands in the buffer and observers hear about it.
  const measure = (name: string) => {
    buffer.push({ name })
    for (const observer of observers) observer({ getEntries: () => [{ name }] })
  }
  return { buffer, performance, Observer, scheduler, measure, runTick: () => tick?.(), state: () => ({ observedWith, disconnected, interval, ticking: tick !== null }) }
}

test("React's development render measures are cleared on every tick; ours are kept", () => {
  const h = harness()
  h.measure("​Button")
  const stop = startReactDevMeasureTrim({ performance: h.performance, Observer: h.Observer, scheduler: h.scheduler })
  expect(h.state().observedWith).toEqual({ type: "measure", buffered: true })
  expect(h.state().interval).toBe(REACT_DEV_MEASURE_TRIM_MS)

  for (let round = 0; round < 1000; round += 1) {
    h.measure("​Button")
    h.measure("​TooltipTrigger")
    h.measure("Cascading Update")
  }
  h.measure("openwork.mcp-app.first-paint")
  expect(h.buffer.length).toBe(3002)

  h.runTick()
  expect(h.buffer.map((entry) => entry.name)).toEqual(["openwork.mcp-app.first-paint"])

  // Later renders are cleared on the next tick, so the buffer stays bounded.
  h.measure("​Button")
  h.runTick()
  expect(h.buffer.map((entry) => entry.name)).toEqual(["openwork.mcp-app.first-paint"])

  h.measure("​Dialog")
  stop()
  expect(h.state()).toMatchObject({ disconnected: true, ticking: false })
  expect(h.buffer.map((entry) => entry.name)).toEqual(["openwork.mcp-app.first-paint"])
})

test("without User Timing support the trim does nothing", () => {
  const stop = startReactDevMeasureTrim({ performance: { clearMeasures: () => {} }, Observer: undefined, scheduler: { setInterval: () => { throw new Error("must not schedule") }, clearInterval: () => {} } })
  expect(typeof stop).toBe("function")
  stop()
})
