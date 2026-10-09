import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@workspace/ui/components/questionnaire'
import type { NativeActionCardData } from './native-action-card'

export function NativeQuestionnaire({ data, disabled, onSubmit }: {
  data: Pick<NativeActionCardData, 'choices' | 'selectionMode'>
  disabled: boolean
  onSubmit: (answer: string | string[]) => void
}) {
  const choices = data.choices ?? []
  const multiple = choices.length > 0 && data.selectionMode === 'multi_select'
  const title = choices.length ? multiple ? 'Choose answers' : 'Choose an answer' : 'Your answer'
  return (
    <Questionnaire
      items={[{ name: 'answer', required: true, choices: choices.map(choice => ({ value: choice.label, disabled })) }]}
      aria-busy={disabled || undefined}
      onSubmit={event => {
        event.preventDefault()
        if (disabled) return
        const form = new FormData(event.currentTarget)
        const answer = multiple ? form.getAll('answer').map(String) : String(form.get('answer') ?? '')
        onSubmit(typeof answer === 'string' && !choices.length ? answer.trim() : answer)
      }}
    >
      <QuestionnaireItem name="answer" required multiple={multiple}>
        <QuestionnaireTitle>{title}</QuestionnaireTitle>
        {choices.length ? (
          <QuestionnaireChoices>
            {choices.map(choice => (
              <QuestionnaireChoice key={choice.label} value={choice.label} disabled={disabled}>
                <span>{choice.label}</span>
                {choice.description && <QuestionnaireChoiceDescription>{choice.description}</QuestionnaireChoiceDescription>}
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
        ) : <QuestionnaireInput aria-label="Your answer" disabled={disabled} />}
        <QuestionnaireError>{choices.length ? multiple ? 'Select at least one answer to continue.' : 'Choose an answer to continue.' : 'Enter an answer to continue.'}</QuestionnaireError>
      </QuestionnaireItem>
      <QuestionnaireActions>
        <QuestionnaireSubmit disabled={disabled}>Send answer</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  )
}
