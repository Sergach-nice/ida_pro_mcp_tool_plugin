// plugins/mcp-ida.js (V2)
// Registers 5 ida-pro-mcp bridge tools via ctx.tool.transform.
import { Plugin } from "@opencode/plugin"

import { instances, call, tools, open, close } from "./tool/ida_mcp.js"

export default Plugin.define({
  id: "mcp-ida",

  async setup(ctx) {
    await ctx.tool.transform((toolsEditor) => {
      // ida_mcp_instances
      toolsEditor.add({
        name: "ida_mcp_instances",
        description: instances.description,
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => {
          const r = await instances.execute({})
          return { content: r.output }
        },
      })

      // ida_mcp_tools
      toolsEditor.add({
        name: "ida_mcp_tools",
        description: tools.description,
        input: {
          type: "object",
          properties: {
            target: {
              type: "object",
              properties: {
                port: { type: "number" },
                binary: { type: "string" },
              },
            },
          },
          additionalProperties: false,
        },
        execute: async (input) => {
          const r = await tools.execute(input)
          return { content: r.output }
        },
      })

      // ida_mcp_call
      toolsEditor.add({
        name: "ida_mcp_call",
        description: call.description,
        input: {
          type: "object",
          properties: {
            target: {
              type: "object",
              properties: {
                port: { type: "number" },
                binary: { type: "string" },
              },
            },
            tool: { type: "string" },
            args: { type: "string" },
          },
          required: ["tool"],
          additionalProperties: false,
        },
        execute: async (input) => {
          const r = await call.execute(input)
          return { content: r.output }
        },
      })

      // ida_mcp_open
      toolsEditor.add({
        name: "ida_mcp_open",
        description: open.description,
        input: {
          type: "object",
          properties: {
            file: { type: "string" },
            closeOld: { type: "boolean" },
          },
          required: ["file"],
          additionalProperties: false,
        },
        execute: async (input) => {
          const r = await open.execute(input)
          return { content: r.output }
        },
      })

      // ida_mcp_close
      toolsEditor.add({
        name: "ida_mcp_close",
        description: close.description,
        input: {
          type: "object",
          properties: {
            port: { type: "number" },
            save: { type: "boolean" },
          },
          required: ["port"],
          additionalProperties: false,
        },
        execute: async (input) => {
          const r = await close.execute(input)
          return { content: r.output }
        },
      })
    })
  },
})
