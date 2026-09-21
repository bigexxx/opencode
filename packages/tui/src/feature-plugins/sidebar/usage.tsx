import type { ProviderUsage } from "@opencode-ai/sdk/v2"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function Usage(props: { api: Pick<TuiPluginApi, "client" | "theme" | "state">; cost: number }) {
  const theme = () => props.api.theme.current
  const enabled = createMemo(() => props.api.state.provider.some((provider) => provider.id === "openai"))
  const [usage, setUsage] = createSignal<ProviderUsage>()

  createEffect(() => {
    setUsage(undefined)
    if (!enabled()) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      const result = await props.api.client.provider
        .usage({ providerID: "openai" }, { signal: controller.signal })
        .then((response) => response.data)
        .catch(() => undefined)
      if (controller.signal.aborted) return
      setUsage(result ?? { status: "unavailable", windows: [] })
      timer = setTimeout(refresh, 60_000)
    }
    void refresh()
    onCleanup(() => {
      controller.abort()
      clearTimeout(timer)
    })
  })

  return (
    <box marginTop={1}>
      <text fg={theme().text}>
        <b>Usage</b>
      </text>
      <text fg={theme().textMuted}>{money.format(props.cost)} spent</text>
      <Show when={usage() && usage()?.status !== "unsupported"}>
        <box marginTop={1} gap={1}>
          <text fg={theme().textMuted}>OpenAI account-wide limits</text>
          <Show
            when={usage()?.status === "available"}
            fallback={<text fg={theme().textMuted}>Usage limits unavailable</text>}
          >
            <For each={usage()?.windows}>
              {(window) => {
                const filled = () => Math.round(window.remainingPercent / 5)
                const color = () =>
                  window.remainingPercent <= 10
                    ? theme().error
                    : window.remainingPercent <= 25
                      ? theme().warning
                      : theme().success
                return (
                  <box>
                    <text fg={theme().text}>
                      {window.name}: {Math.floor(window.remainingPercent)}% left
                    </text>
                    <text>
                      <span style={{ fg: color() }}>{"━".repeat(filled())}</span>
                      <span style={{ fg: theme().textMuted }}>{"─".repeat(20 - filled())}</span>
                    </text>
                    <text fg={theme().textMuted}>
                      Resets{" "}
                      {new Date(window.resetsAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </text>
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
      </Show>
    </box>
  )
}
