import os from 'os'
import { statfs } from 'fs/promises'
import { CapacitySample } from './store'
export class CapacityCollector {
  private previous = os.cpus().map(c => c.times)
  private sends: number[] = []
  sent(): void { this.sends.push(Date.now()) }
  async sample(owned: number, connected: number, renewLatencyMs: number): Promise<CapacitySample> {
    const cpus = os.cpus().map(c => c.times)
    let total = 0, idle = 0
    cpus.forEach((cpu, index) => {
      const prev = this.previous[index] || cpu
      idle += cpu.idle - prev.idle
      for (const key of ['user','nice','sys','idle','irq'] as const) total += cpu[key] - prev[key]
    })
    this.previous = cpus
    this.sends = this.sends.filter(t => t > Date.now() - 60000)
    const disk = await statfs(process.cwd())
    return { cpuPercent: total ? Math.max(0, Math.min(100, 100 * (1 - idle / total))) : 0,
      ramPercent: 100 * (1 - os.freemem() / os.totalmem()), diskPercent: disk.blocks ? 100 * (1 - disk.bavail / disk.blocks) : 0,
      owned, connected, messagesPerMinute: this.sends.length, renewLatencyMs }
  }
}
export function recommendFleet(nodes: Array<{ enabled: boolean; state: string }>, samples: CapacitySample[]): 'add-node' | 'upgrade-node' | 'healthy' | 'insufficient-data' {
  if (nodes.filter(n => n.enabled && n.state === 'ready').length < 2) return 'add-node'
  if (samples.length < 3) return 'insufficient-data'
  // Phase 1 is active/standby: more standby nodes do not shard active load.
  return samples.slice(-3).every(s => s.cpuPercent >= 80 || s.ramPercent >= 85 || s.diskPercent >= 85) ? 'upgrade-node' : 'healthy'
}
