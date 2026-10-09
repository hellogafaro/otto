import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NativeQuestionnaire } from '../native-questionnaire'

describe('native question adapter uses the installed official Questionnaire', () => {
  it('renders one required official fieldset and legend with native single-choice inputs', () => {
    const html = renderToStaticMarkup(<NativeQuestionnaire data={{ choices: [{ label: 'First', description: 'Reviewed first option.' }, { label: 'Second' }] }} disabled={false} onSubmit={() => {}} />)
    expect(html).toContain('data-slot="questionnaire"')
    expect(html).toContain('data-slot="questionnaire-item"')
    expect(html).toContain('<fieldset')
    expect(html).toContain('<legend')
    expect(html).toContain('Choose an answer')
    expect(html).toContain('type="radio"')
    expect(html).toContain('name="answer"')
    expect(html).toContain('Reviewed first option.')
    expect(html).toContain('data-slot="questionnaire-submit"')
    expect(html).not.toContain('>Skip<')
    expect(html).not.toContain('questionnaire-input"')
  })

  it('maps existing multi-select to official native checkbox choices without a new answer contract', () => {
    const html = renderToStaticMarkup(<NativeQuestionnaire data={{ selectionMode: 'multi_select', choices: [{ label: 'First' }, { label: 'Second' }] }} disabled={false} onSubmit={() => {}} />)
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('Choose answers')
    expect(html).not.toContain('type="radio"')
  })

  it('maps existing freeform to the official named input and leaves state and validation with Questionnaire', () => {
    const html = renderToStaticMarkup(<NativeQuestionnaire data={{}} disabled={false} onSubmit={() => {}} />)
    expect(html).toContain('data-slot="questionnaire-input"')
    expect(html).toContain('aria-label="Your answer"')
    expect(html).toContain('type="text"')
    expect(html).not.toContain('<textarea')
  })

  it('disables transport controls without granting permission to skip or synthesizing an answer', () => {
    let calls = 0
    const html = renderToStaticMarkup(<NativeQuestionnaire data={{}} disabled onSubmit={() => { calls += 1 }} />)
    expect(html).toContain('disabled')
    expect(html).not.toContain('>Skip<')
    expect(calls).toBe(0)
  })
})
