import ExpoModulesCore

public class OttoLegacyComposerEditorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OttoLegacyComposerEditor")

    View(OttoLegacyComposerEditorView.self) {
      Prop("controlledDocumentJson") { (view: OttoLegacyComposerEditorView, documentJson: String) in
        view.setControlledDocumentJson(documentJson)
      }
      Prop("themeJson") { (view: OttoLegacyComposerEditorView, themeJson: String) in
        view.setThemeJson(themeJson)
      }
      Prop("placeholder") { (view: OttoLegacyComposerEditorView, placeholder: String) in
        view.setPlaceholder(placeholder)
      }
      Prop("fontFamily") { (view: OttoLegacyComposerEditorView, fontFamily: String) in
        view.setFontFamily(fontFamily)
      }
      Prop("fontSize") { (view: OttoLegacyComposerEditorView, fontSize: Double) in
        view.setFontSize(CGFloat(fontSize))
      }
      Prop("lineHeight") { (view: OttoLegacyComposerEditorView, lineHeight: Double) in
        view.setLineHeight(CGFloat(lineHeight))
      }
      Prop("contentInsetVertical") { (view: OttoLegacyComposerEditorView, contentInsetVertical: Double) in
        view.setContentInsetVertical(CGFloat(contentInsetVertical))
      }
      Prop("editable") { (view: OttoLegacyComposerEditorView, editable: Bool) in
        view.setEditable(editable)
      }
      Prop("scrollEnabled") { (view: OttoLegacyComposerEditorView, scrollEnabled: Bool) in
        view.setScrollEnabled(scrollEnabled)
      }
      Prop("autoFocus") { (view: OttoLegacyComposerEditorView, autoFocus: Bool) in
        view.setAutoFocus(autoFocus)
      }
      Prop("autoCorrect") { (view: OttoLegacyComposerEditorView, autoCorrect: Bool) in
        view.setAutoCorrect(autoCorrect)
      }
      Prop("spellCheck") { (view: OttoLegacyComposerEditorView, spellCheck: Bool) in
        view.setSpellCheck(spellCheck)
      }

      Events(
        "onComposerChange",
        "onComposerSelectionChange",
        "onComposerFocus",
        "onComposerBlur",
        "onComposerSubmit",
        "onComposerPasteImages",
        "onComposerContentSizeChange"
      )

      AsyncFunction("focus") { (view: OttoLegacyComposerEditorView) in
        view.focusEditor()
      }
      AsyncFunction("blur") { (view: OttoLegacyComposerEditorView) in
        view.blurEditor()
      }
      AsyncFunction("setSelection") { (view: OttoLegacyComposerEditorView, start: Int, end: Int) in
        view.setSelection(start: start, end: end)
      }
    }
  }
}
