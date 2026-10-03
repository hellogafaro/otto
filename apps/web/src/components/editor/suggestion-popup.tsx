import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import {
  type ComponentType,
  type Ref,
  useImperativeHandle,
  useState,
} from "react";

// Shared by the "/" and "@" menus: a list rendered next to the caret (below
// it, or above when there is no room), with arrow keys, Enter/Tab and Escape.
export type ListHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

export type ListProps<T> = SuggestionProps<T> & { ref?: Ref<ListHandle> };

export function suggestionPopup<T>(
  List: ComponentType<ListProps<T>>,
): SuggestionOptions<T>["render"] {
  return () => {
    let renderer: ReactRenderer<ListHandle, ListProps<T>> | null = null;
    const close = () => {
      renderer?.destroy();
      renderer?.element.remove();
      renderer = null;
    };
    const place = (rect: DOMRect | null | undefined) => {
      const element = renderer?.element as HTMLElement | undefined;
      if (!element || !rect) return;
      const height = element.offsetHeight;
      const below = rect.bottom + 4 + height <= window.innerHeight;
      Object.assign(element.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${below ? rect.bottom + 4 : rect.top - 4 - height}px`,
        zIndex: "50",
      });
    };
    return {
      onStart: (props) => {
        renderer = new ReactRenderer(List, { props, editor: props.editor });
        document.body.appendChild(renderer.element);
        requestAnimationFrame(() => place(props.clientRect?.()));
      },
      onUpdate: (props) => {
        renderer?.updateProps(props);
        requestAnimationFrame(() => place(props.clientRect?.()));
      },
      onKeyDown: (props) => {
        if (props.event.key === "Escape") {
          close();
          return true;
        }
        return renderer?.ref?.onKeyDown(props) ?? false;
      },
      onExit: close,
    };
  };
}

// Keyboard selection for a suggestion list; resets when the items change.
export function useSuggestionKeys<T>(
  ref: Ref<ListHandle> | undefined,
  items: T[],
  pick: (item: T) => void,
) {
  const [selected, setSelected] = useState(0);
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setSelected(0);
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setSelected((index) => (index + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelected((index) => (index - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        pick(items[selected]);
        return true;
      }
      return false;
    },
  }));

  return [selected, setSelected] as const;
}
