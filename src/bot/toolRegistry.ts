import type { BotTool, BotContext } from '../types'

const registeredTools: Map<string, BotTool> = new Map()

export function registerTool(tool: BotTool): void {
  registeredTools.set(tool.name, tool)
}

export function getTools(): BotTool[] {
  return [...registeredTools.values()]
}

export async function dispatchTool(
  name: string,
  args: unknown,
  ctx: BotContext,
): Promise<string> {
  const tool = registeredTools.get(name)
  if (!tool) {
    console.warn(`[bot] Unknown tool: ${name}`)
    return `(Tool '${name}' not available)`
  }
  return tool.execute(args as Record<string, unknown>, ctx)
}
