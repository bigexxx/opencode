import type { Auth } from "@/auth"
import type { Provider } from "./provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect, Schema } from "effect"

export class Window extends Schema.Class<Window>("ProviderUsageWindow")({
  name: Schema.String,
  remainingPercent: Schema.Finite,
  resetsAt: Schema.Finite,
}) {}

export class Info extends Schema.Class<Info>("ProviderUsage")({
  status: Schema.Literals(["available", "unavailable", "unsupported"]),
  windows: Schema.Array(Window),
}) {}

const CodexWindow = Schema.Struct({
  used_percent: Schema.Finite,
  limit_window_seconds: Schema.Finite.check(Schema.isGreaterThan(0)),
  reset_at: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
})

const CodexUsage = Schema.Struct({
  rate_limit: Schema.NullOr(
    Schema.Struct({
      primary_window: Schema.optional(Schema.NullOr(CodexWindow)),
      secondary_window: Schema.optional(Schema.NullOr(CodexWindow)),
    }),
  ),
})

export function parse(input: unknown): Info {
  const data = Schema.decodeUnknownSync(CodexUsage)(input)
  const windows = [data.rate_limit?.primary_window, data.rate_limit?.secondary_window]
    .filter((window) => window !== undefined && window !== null)
    .sort((a, b) => b.limit_window_seconds - a.limit_window_seconds)
    .map(
      (window) =>
        new Window({
          name:
            window.limit_window_seconds === 604800
              ? "Weekly"
              : window.limit_window_seconds % 86400 === 0
                ? `${window.limit_window_seconds / 86400}-day`
                : window.limit_window_seconds % 3600 === 0
                  ? `${window.limit_window_seconds / 3600}-hour`
                  : `${Math.ceil(window.limit_window_seconds / 60)}-minute`,
          remainingPercent: Math.max(0, Math.min(100, 100 - window.used_percent)),
          resetsAt: window.reset_at * 1000,
        }),
    )
  return new Info({ status: windows.length ? "available" : "unavailable", windows })
}

export const read = Effect.fn("ProviderUsage.read")(
  function* (
    auth: Pick<Auth.Interface, "get">,
    provider: Pick<Provider.Interface, "getProvider">,
    providerID: ProviderV2.ID,
  ) {
    if (providerID !== "openai") return new Info({ status: "unsupported", windows: [] })
    const credential = yield* auth.get(providerID)
    if (credential?.type !== "oauth") return new Info({ status: "unsupported", windows: [] })
    const info = yield* provider.getProvider(providerID)
    const request: unknown = info?.options.fetch
    if (typeof request !== "function") return new Info({ status: "unavailable", windows: [] })

    // Reuse the provider's OAuth fetch so token refresh and account selection
    // stay shared with model requests. Credentials never reach the client.
    return yield* Effect.tryPromise(async (signal) => {
      const response: Response = await request("https://chatgpt.com/backend-api/wham/usage", {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal,
      })
      if (!response.ok) return new Info({ status: "unavailable", windows: [] })
      return parse(await response.json())
    }).pipe(Effect.timeout("10 seconds"))
  },
  Effect.orElseSucceed(() => new Info({ status: "unavailable", windows: [] })),
)

export * as ProviderUsage from "./usage"
