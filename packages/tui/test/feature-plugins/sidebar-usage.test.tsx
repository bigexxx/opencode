import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createOpencodeClient, type ProviderUsage } from "@opencode-ai/sdk/v2"
import { Usage } from "../../src/feature-plugins/sidebar/usage"
import { createTuiPluginApi } from "../fixture/tui-plugin"

test("renders remaining subscription limits and hides API-key accounts", async () => {
  const cases: { usage: ProviderUsage; text?: string }[] = [
    {
      usage: {
        status: "available",
        windows: [
          { name: "Weekly", remainingPercent: 25, resetsAt: 1800500000000 },
          { name: "5-hour", remainingPercent: 0, resetsAt: 1800000000000 },
        ],
      },
      text: "Weekly: 25% left",
    },
    { usage: { status: "unavailable", windows: [] }, text: "Usage limits unavailable" },
    { usage: { status: "unsupported", windows: [] } },
  ]
  for (const item of cases) {
    const loaded = Promise.withResolvers<void>()
    const api = createTuiPluginApi({
      client: createOpencodeClient({
        baseUrl: "http://localhost:4096",
        fetch: Object.assign(
          async (request: RequestInfo | URL) => {
            expect(new URL(request instanceof Request ? request.url : String(request)).pathname).toBe(
              "/provider/openai/usage",
            )
            loaded.resolve()
            return Response.json(item.usage)
          },
          { preconnect: fetch.preconnect },
        ),
      }),
    })
    const app = await testRender(
      () => (
        <Usage
          cost={1.25}
          api={{
            ...api,
            state: {
              ...api.state,
              provider: [{ id: "openai", name: "OpenAI", source: "custom", env: [], options: {}, models: {} }],
            },
          }}
        />
      ),
      { width: 37, height: 16 },
    )
    try {
      await loaded.promise
      for (let attempt = 0; attempt < 20; attempt++) {
        await app.renderOnce()
        if (item.text && app.captureCharFrame().includes(item.text)) break
        await Bun.sleep(5)
      }
      const frame = app.captureCharFrame()
      expect(frame).toContain("Usage")
      expect(frame).toContain("$1.25 spent")
      expect(frame.indexOf("Usage")).toBeLessThan(frame.indexOf("$1.25 spent"))
      if (!item.text) {
        expect(frame).not.toContain("OpenAI account-wide limits")
        continue
      }
      expect(frame).toContain("OpenAI account-wide limits")
      expect(frame.indexOf("$1.25 spent")).toBeLessThan(frame.indexOf("OpenAI account-wide limits"))
      expect(frame).toContain(item.text)
      if (item.usage.status !== "available") continue
      expect(frame).toContain("━━━━━───────────────")
      expect(frame).toContain("5-hour: 0% left")
      expect(frame).toContain("Resets")
    } finally {
      app.renderer.destroy()
    }
  }
})
