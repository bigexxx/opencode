import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo } from "solid-js"
import { Usage } from "./usage"

const id = "internal:sidebar-context"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    const rates = msg()
      .filter(
        (item): item is AssistantMessage & { time: { created: number; completed: number } } =>
          item.role === "assistant" &&
          item.tokens.output > 0 &&
          item.time.completed != null &&
          item.time.completed > item.time.created,
      )
      .map((item) => item.tokens.output / ((item.time.completed - item.time.created) / 1000))
    const recent = rates.slice(-10)
    const lastSpeed = recent.length ? recent[recent.length - 1] : null
    const avgSpeed = recent.length ? recent.reduce((sum, rate) => sum + rate, 0) / recent.length : null
    if (!last) {
      return {
        tokens: 0,
        percent: null,
        lastSpeed,
        avgSpeed,
        turns: recent.length,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
      lastSpeed,
      avgSpeed,
      turns: recent.length,
    }
  })

  const info = state()
  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{info.tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{info.percent ?? 0}% used</text>
      {info.lastSpeed != null && <text fg={theme().textMuted}>last {info.lastSpeed.toFixed(1)} tok/s</text>}
      {info.avgSpeed != null && (
        <text fg={theme().textMuted}>
          {`avg ${info.avgSpeed.toFixed(1)} tok/s${info.turns < 10 ? ` (${info.turns})` : ""}`}
        </text>
      )}
      <Usage api={props.api} cost={session()?.cost ?? 0} />
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
