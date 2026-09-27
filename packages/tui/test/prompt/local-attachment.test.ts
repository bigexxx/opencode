import { describe, expect, test } from "bun:test"
import { pastedAttachmentPath, readLocalAttachmentWith } from "../../src/component/prompt/local-attachment"
import type { LocalFiles } from "../../src/component/prompt/local-attachment"

function files(input: { mime: string; text?: string; bytes?: Uint8Array }): LocalFiles {
  return {
    mime: async () => input.mime,
    readText: async () => input.text ?? "",
    readBytes: async () => input.bytes ?? new Uint8Array(),
  }
}

describe("prompt local attachments", () => {
  test("keeps copied paths as text but attaches paths dragged into the terminal", () => {
    const screenshot = "/private/var/folders/temporary/Screenshot 2026-09-24.png"
    expect(pastedAttachmentPath(screenshot, screenshot, "darwin")).toBeUndefined()
    expect(pastedAttachmentPath(screenshot.replaceAll(" ", "\\ "), screenshot, "darwin")).toBeUndefined()
    expect(pastedAttachmentPath(screenshot, "/Users/example/other.png", "darwin")).toBe(screenshot)
    expect(pastedAttachmentPath(screenshot, undefined, "darwin")).toBe(screenshot)
    expect(pastedAttachmentPath("file:///tmp/image%20one.png", "/tmp/image one.png", "darwin")).toBeUndefined()
    expect(pastedAttachmentPath("C:\\Temp\\image.png", "C:\\Temp\\image.png", "win32")).toBeUndefined()
  })

  test("reads SVG attachments as text", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "image/svg+xml", text: "<svg />" }), "/tmp/image.svg")).toEqual({
      type: "text",
      mime: "image/svg+xml",
      content: "<svg />",
    })
  })

  test("reads image and PDF attachments as bytes", async () => {
    const content = new Uint8Array([1, 2, 3])
    expect(await readLocalAttachmentWith(files({ mime: "application/pdf", bytes: content }), "/tmp/file.pdf")).toEqual({
      type: "binary",
      mime: "application/pdf",
      content,
    })
  })

  test("ignores unsupported and unreadable local files", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "text/plain" }), "/tmp/file.txt")).toBeUndefined()
    expect(
      await readLocalAttachmentWith(
        {
          ...files({ mime: "image/png" }),
          readBytes: async () => Promise.reject(new Error("missing")),
        },
        "/tmp/missing.png",
      ),
    ).toBeUndefined()
  })
})
