import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collect } from '../types'
import { BOX_HOME, DOCS_MOUNT, SKILLS_MOUNT, boxChatDir, createPathMap } from '../paths'
import { DirComputer } from './dir-computer'

const map = createPathMap({
  chatId: 'chat00000001',
  hostChatDir: '/srv/ws/sessions/chat00000001/',
  hostSkillsDir: '/srv/ws/skills',
  hostDocsDir: '/home/me/.otto/docs',
  hostSourcesDir: '/srv/ws/sources',
  files: [['/srv/ws/library/item00000001', '/home/agent/chats/chat00000001/attachments/report.pdf']],
  textAliases: [['~/.otto/docs', '/otto/docs']],
})

describe('createPathMap', () => {
  test('the chat folder, skills and docs map both ways; nothing else on the host is visible', () => {
    expect(map.cwd).toBe('/home/agent/chats/chat00000001')
    expect(map.toBox('/srv/ws/sessions/chat00000001')).toBe('/home/agent/chats/chat00000001')
    expect(map.toBox('/srv/ws/sessions/chat00000001/downloads/shot.png')).toBe('/home/agent/chats/chat00000001/downloads/shot.png')
    expect(map.toBox('/srv/ws/skills/deploy/SKILL.md')).toBe(`${SKILLS_MOUNT}/deploy/SKILL.md`)
    expect(map.toBox('/home/me/.otto/docs/otto.md')).toBe(`${DOCS_MOUNT}/otto.md`)
    expect(map.toBox('/srv/ws/sessions/chat00000001x/a')).toBeNull()
    expect(map.toBox('/srv/ws/sources/linear/guide.md')).toBe('/sources/linear/guide.md')
    expect(map.toBox('/srv/ws/config.json')).toBeNull()

    expect(map.toHost('/home/agent/chats/chat00000001/downloads/shot.png')).toBe('/srv/ws/sessions/chat00000001/downloads/shot.png')
    expect(map.toHost('/skills/deploy/SKILL.md')).toBe('/srv/ws/skills/deploy/SKILL.md')
    expect(map.toHost('/otto/docs/otto.md')).toBe('/home/me/.otto/docs/otto.md')
    expect(map.toHost(`${BOX_HOME}/files/notes.md`)).toBeNull()
  })

  test('box paths: relative to the chat folder, ~ is the agent home, .. is resolved', () => {
    expect(map.toHost('out/a.txt')).toBe('/srv/ws/sessions/chat00000001/out/a.txt')
    expect(map.toHost('~/chats/chat00000001/a')).toBe('/srv/ws/sessions/chat00000001/a')
    expect(map.toHost('/home/agent/chats/chat00000001/../other/a')).toBeNull()
  })

  test('a copied file maps to its source, ahead of the folder it sits in', () => {
    expect(map.toBox('/srv/ws/library/item00000001')).toBe('/home/agent/chats/chat00000001/attachments/report.pdf')
    expect(map.toHost('/home/agent/chats/chat00000001/attachments/report.pdf')).toBe('/srv/ws/library/item00000001')
    expect(map.toBox('/srv/ws/library/item00000002')).toBeNull()
    const more = map.withFiles([['/srv/ws/library/item00000002', '/home/agent/chats/chat00000001/attachments/b.png']])
    expect(more.toBox('/srv/ws/library/item00000002')).toBe('/home/agent/chats/chat00000001/attachments/b.png')
  })

  test('textToBox rewrites whole host folders in prompt text only', () => {
    const text = [
      '<working_directory>/srv/ws/sessions/chat00000001</working_directory>',
      'Read /home/me/.otto/docs/browser-tools.md first.',
      'Skill: /srv/ws/skills/deploy/SKILL.md',
      'Other chat: /srv/ws/sessions/chat00000001x/plans',
      'Guide: ~/.otto/docs/otto.md',
    ].join('\n')
    expect(map.textToBox(text)).toBe([
      '<working_directory>/home/agent/chats/chat00000001</working_directory>',
      'Read /otto/docs/browser-tools.md first.',
      'Skill: /skills/deploy/SKILL.md',
      'Other chat: /srv/ws/sessions/chat00000001x/plans',
      'Guide: /otto/docs/otto.md',
    ].join('\n'))
  })

  test('chat ids are checked', () => {
    expect(() => boxChatDir('a/b')).toThrow('invalid chat id')
    expect(() => createPathMap({ chatId: '..', hostChatDir: '/x' })).toThrow('invalid chat id')
  })
})

describe('DirComputer (the test double)', () => {
  const made: DirComputer[] = []
  const dirs: string[] = []
  afterEach(() => {
    for (const c of made.splice(0)) c.dispose()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  test('commands see box paths, mounts and HOME; output shows box paths', async () => {
    const skills = mkdtempSync(join(tmpdir(), 'otto-skills-'))
    dirs.push(skills)
    mkdirSync(join(skills, 'deploy'))
    writeFileSync(join(skills, 'deploy', 'SKILL.md'), 'ship it\n')
    const box = new DirComputer({ mounts: { [SKILLS_MOUNT]: skills } })
    made.push(box)
    await box.ensureRunning()
    const cwd = boxChatDir('chat00000001')
    expect((await collect(box.exec(['mkdir', '-p', cwd]))).code).toBe(0)
    const r = await collect(box.exec(['bash', '-c', 'pwd; echo $HOME; cat /skills/deploy/SKILL.md; echo hi > note.txt; ls /home/agent/chats/chat00000001'], { cwd }))
    expect(r).toEqual({ code: 0, stdout: `${cwd}\n/home/agent\nship it\nnote.txt\n`, stderr: '' })
  })

  test('a crash ends the running command like a dead box, and the next start brings it back', async () => {
    const box = new DirComputer()
    made.push(box)
    await box.ensureRunning()
    const running = box.exec(['sleep', '30'])
    setTimeout(() => box.crash(), 50)
    const r = await collect(running)
    expect(r.code).toBe(-1)
    expect(r.stderr).toContain('computer restarted; the action may have run')
    expect((await collect(box.exec(['true']))).code).toBe(1)
    await box.ensureRunning()
    expect((await collect(box.exec(['true']))).code).toBe(0)
    expect(box.starts).toBe(2)
  })
})
