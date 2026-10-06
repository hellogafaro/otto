import type { FormEvent } from 'react'
import type { AnyFormApi } from '@tanstack/react-form'

/**
 * A `<form>`'s `onSubmit` for a TanStack form: submits it (validating on submit, as on blur, never on change),
 * and when validation refuses, focuses the first field it marked invalid (after React has rendered
 * `aria-invalid`). See DESIGN.md, Forms. Fields validate first: `handleSubmit` refuses a form that already has
 * an error (a blurred field's) before validating the rest, which would leave the other invalid fields unmarked.
 */
export function submitForm(event: FormEvent<HTMLFormElement>, form: AnyFormApi): void {
  event.preventDefault()
  event.stopPropagation()
  const element = event.currentTarget
  void form.validateAllFields('submit').then(() => form.handleSubmit()).then(() => {
    if (!form.state.isValid) requestAnimationFrame(() => element.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  })
}
