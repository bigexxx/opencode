import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { copyCommand, readMacFilePaths } from "../src/clipboard"

const exec = promisify(execFile)

test("reads macOS file URLs as paths without changing the system clipboard", async () => {
  if (process.platform !== "darwin") return
  const name = `opencode-clipboard-test-${crypto.randomUUID()}`
  await exec("osascript", [
    "-l",
    "JavaScript",
    "-e",
    'ObjC.import("AppKit"); function run(argv) { const board = $.NSPasteboard.pasteboardWithName($(argv[0])); board.writeObjects($([$.NSURL.fileURLWithPath($("/tmp/example image.png"))])); }',
    name,
  ])
  try {
    expect(await readMacFilePaths(name)).toEqual(["/tmp/example image.png"])
  } finally {
    await exec("osascript", [
      "-l",
      "JavaScript",
      "-e",
      'ObjC.import("AppKit"); function run(argv) { $.NSPasteboard.pasteboardWithName($(argv[0])).releaseGlobally; }',
      name,
    ])
  }
})

test("prefers Wayland clipboard when available", () => {
  expect(copyCommand("linux", true, (name) => name === "wl-copy")).toEqual(["wl-copy"])
})

test("uses osascript on macOS", () => {
  expect(copyCommand("darwin", false, (name) => name === "osascript")).toEqual(["osascript"])
})

test("falls back through X11 clipboard commands", () => {
  expect(copyCommand("linux", true, (name) => name === "xclip")).toEqual(["xclip", "-selection", "clipboard"])
  expect(copyCommand("linux", false, (name) => name === "xsel")).toEqual(["xsel", "--clipboard", "--input"])
})

test("returns undefined when native clipboard is unavailable", () => {
  expect(copyCommand("linux", false, () => false)).toBeUndefined()
})
