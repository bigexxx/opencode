import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderUsage } from "@/provider/usage"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const providerID = ProviderV2.ID.make("openai")
const payload = {
  rate_limit: {
    primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: 1800000000 },
    secondary_window: { used_percent: 75, limit_window_seconds: 604800, reset_at: 1800500000 },
  },
}

describe("subscription usage", () => {
  test("puts weekly remaining allowance first and converts reset timestamps", () => {
    expect(ProviderUsage.parse(payload)).toEqual({
      status: "available",
      windows: [
        { name: "Weekly", remainingPercent: 25, resetsAt: 1800500000000 },
        { name: "5-hour", remainingPercent: 80, resetsAt: 1800000000000 },
      ],
    })
  })

  test("encodes populated and empty results through the HTTP response schema", () => {
    const encode = Schema.encodeSync(ProviderUsage.Info)
    expect(encode(ProviderUsage.parse(payload))).toEqual({
      status: "available",
      windows: [
        { name: "Weekly", remainingPercent: 25, resetsAt: 1800500000000 },
        { name: "5-hour", remainingPercent: 80, resetsAt: 1800000000000 },
      ],
    })
    expect(encode(ProviderUsage.parse({ rate_limit: null }))).toEqual({ status: "unavailable", windows: [] })
  })

  test("does not invent an allowance when windows are missing", () => {
    expect(ProviderUsage.parse({ rate_limit: null })).toEqual({ status: "unavailable", windows: [] })
    expect(ProviderUsage.parse({ rate_limit: { primary_window: null } }).windows).toEqual([])
    expect(() => ProviderUsage.parse({})).toThrow()
    expect(() => ProviderUsage.parse({ rate_limit: { primary_window: { used_percent: 10 } } })).toThrow()
  })

  test("clamps over-limit values and uses actual window durations", () => {
    expect(
      ProviderUsage.parse({
        rate_limit: {
          primary_window: { used_percent: 110, limit_window_seconds: 900, reset_at: 1800000000 },
          secondary_window: { used_percent: -1, limit_window_seconds: 86400, reset_at: 1800000000 },
        },
      }).windows,
    ).toEqual([
      { name: "1-day", remainingPercent: 100, resetsAt: 1800000000000 },
      { name: "15-minute", remainingPercent: 0, resetsAt: 1800000000000 },
    ])
  })

  it.effect("skips API keys and unsupported providers without loading a provider", () =>
    Effect.gen(function* () {
      const auth = { get: () => Effect.succeed({ type: "api" as const, key: "test" }) }
      const provider = { getProvider: () => Effect.die("must not load provider") }
      expect(yield* ProviderUsage.read(auth, provider, providerID)).toEqual({ status: "unsupported", windows: [] })
      expect(yield* ProviderUsage.read(auth, provider, ProviderV2.ID.make("anthropic"))).toEqual({
        status: "unsupported",
        windows: [],
      })
    }),
  )

  it.live("uses authenticated provider transport and handles upstream failures without exposing them", () =>
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            port: 0,
            fetch(request) {
              const path = new URL(request.url).pathname
              if (path === "/denied") return new Response("private upstream error", { status: 401 })
              if (path === "/invalid") return Response.json({ rate_limit: { primary_window: {} } })
              return Response.json(payload)
            },
          }),
        ),
        (server) => Effect.sync(() => server.stop(true)),
      )
      const auth = {
        get: () => Effect.succeed({ type: "oauth" as const, access: "secret", refresh: "secret", expires: 0 }),
      }
      for (const path of ["/usage", "/denied", "/invalid"]) {
        const provider = {
          getProvider: () =>
            Effect.succeed({
              id: providerID,
              name: "OpenAI",
              source: "custom" as const,
              env: [],
              models: {},
              options: {
                fetch(url: string, init: RequestInit) {
                  expect(url).toBe("https://chatgpt.com/backend-api/wham/usage")
                  expect(init.method).toBe("GET")
                  expect(init.redirect).toBe("error")
                  expect(init.signal).toBeDefined()
                  return fetch(new URL(path, server.url), init)
                },
              },
            }),
        }
        const result = yield* ProviderUsage.read(auth, provider, providerID)
        expect(result).toEqual(
          path === "/usage" ? ProviderUsage.parse(payload) : { status: "unavailable", windows: [] },
        )
        expect(JSON.stringify(result)).not.toContain("secret")
      }
    }),
  )
})
