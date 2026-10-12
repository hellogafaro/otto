package expo.modules.ottocomposereditor

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OttoLegacyComposerEditorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OttoLegacyComposerEditor")

    View(OttoLegacyComposerEditorView::class) {
      Prop("controlledDocumentJson") { view: OttoLegacyComposerEditorView, documentJson: String ->
        view.setControlledDocumentJson(documentJson)
      }
      Prop("themeJson") { view: OttoLegacyComposerEditorView, themeJson: String ->
        view.setThemeJson(themeJson)
      }
      Prop("placeholder") { view: OttoLegacyComposerEditorView, placeholder: String ->
        view.setPlaceholder(placeholder)
      }
      Prop("fontFamily") { view: OttoLegacyComposerEditorView, fontFamily: String ->
        view.setFontFamily(fontFamily)
      }
      Prop("fontSize") { view: OttoLegacyComposerEditorView, fontSize: Double ->
        view.setFontSize(fontSize.toFloat())
      }
      Prop("lineHeight") { view: OttoLegacyComposerEditorView, lineHeight: Double ->
        view.setLineHeight(lineHeight.toFloat())
      }
      Prop("contentInsetVertical") { view: OttoLegacyComposerEditorView, contentInsetVertical: Double ->
        view.setContentInsetVertical(contentInsetVertical.toInt())
      }

      Prop("singleLineCentered") { view: OttoLegacyComposerEditorView, singleLineCentered: Boolean ->
        view.setSingleLineCentered(singleLineCentered)
      }
      Prop("editable") { view: OttoLegacyComposerEditorView, editable: Boolean ->
        view.setEditable(editable)
      }
      Prop("scrollEnabled") { view: OttoLegacyComposerEditorView, scrollEnabled: Boolean ->
        view.setScrollEnabled(scrollEnabled)
      }
      Prop("autoFocus") { view: OttoLegacyComposerEditorView, autoFocus: Boolean ->
        view.setAutoFocus(autoFocus)
      }
      Prop("autoCorrect") { view: OttoLegacyComposerEditorView, autoCorrect: Boolean ->
        view.setAutoCorrect(autoCorrect)
      }
      Prop("spellCheck") { view: OttoLegacyComposerEditorView, spellCheck: Boolean ->
        view.setSpellCheck(spellCheck)
      }

      Events(
        "onComposerChange",
        "onComposerSelectionChange",
        "onComposerFocus",
        "onComposerBlur",
        "onComposerPasteImages",
        "onComposerContentSizeChange",
      )

      AsyncFunction("focus") { view: OttoLegacyComposerEditorView ->
        view.focusEditor()
      }
      AsyncFunction("blur") { view: OttoLegacyComposerEditorView ->
        view.blurEditor()
      }
      AsyncFunction("setSelection") { view: OttoLegacyComposerEditorView, start: Int, end: Int ->
        view.setSelection(start, end)
      }
    }
  }
}
