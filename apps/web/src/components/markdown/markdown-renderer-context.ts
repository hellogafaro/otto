import React from "react";
import type { useChatMarkdownState } from "./use-chat-markdown-state";

export const ChatMarkdownRendererContext = React.createContext<
  ReturnType<typeof useChatMarkdownState>["componentState"]
>(null!);
