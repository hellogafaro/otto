import { DockerComputer, type DockerComputerOptions } from './docker'
import { LocalComputer } from './local'

export * from './types'
export * from './docker'
export * from './local'

export function createComputer(kind: 'local', opts?: { id?: string }): LocalComputer
export function createComputer(kind: 'docker', opts: DockerComputerOptions): DockerComputer
export function createComputer(
  kind: 'local' | 'docker',
  opts: { id?: string } | DockerComputerOptions = {},
): LocalComputer | DockerComputer {
  switch (kind) {
    case 'local':
      return new LocalComputer((opts as { id?: string }).id)
    case 'docker':
      return new DockerComputer(opts as DockerComputerOptions)
  }
}
