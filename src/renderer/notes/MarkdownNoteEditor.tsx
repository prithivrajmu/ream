import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer
} from "@lexical/markdown";
import { AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { CodeHighlightNode, CodeNode, $createCodeNode } from "@lexical/code";
import { ListItemNode, ListNode, INSERT_CHECK_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import {
  HorizontalRuleNode,
  INSERT_HORIZONTAL_RULE_COMMAND
} from "@lexical/react/LexicalHorizontalRuleNode";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { DEFAULT_TRANSFORMERS, MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode, type HeadingTagType } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  PASTE_COMMAND,
  type EditorState,
  type LexicalEditor,
  type TextFormatType,
  type TextNode
} from "lexical";
import {
  type ForwardedRef,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

export type NoteSaveStatus = "idle" | "saving" | "saved" | "offline" | "failed";

export interface MarkdownNoteEditorHandle {
  focus: () => void;
  insertMarkdownSnippet: (snippet: string) => void;
}

interface MarkdownNoteEditorProps {
  value: string;
  onChange: (nextValue: string) => void;
  taskTitle: string;
  metadata: string[];
  saveStatus: NoteSaveStatus;
  onImproveWithAi: () => void;
  aiAction: ReactNode;
  disabledAi?: boolean;
  showToolbar?: boolean;
}

type BlockFormat = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code";

const NOTE_TRANSFORMERS = DEFAULT_TRANSFORMERS as Transformer[];
const URL_PATTERN = /^https?:\/\/\S+$/i;

const noteEditorTheme = {
  heading: {
    h1: "markdown-note-heading markdown-note-heading-1",
    h2: "markdown-note-heading markdown-note-heading-2",
    h3: "markdown-note-heading markdown-note-heading-3"
  },
  link: "markdown-note-link",
  list: {
    checklist: "markdown-note-checklist",
    listitem: "markdown-note-list-item",
    listitemChecked: "markdown-note-list-item is-checked",
    listitemUnchecked: "markdown-note-list-item is-unchecked",
    nested: {
      listitem: "markdown-note-list-item is-nested"
    },
    ol: "markdown-note-list markdown-note-ordered-list",
    ul: "markdown-note-list markdown-note-unordered-list"
  },
  ltr: "markdown-note-ltr",
  paragraph: "markdown-note-paragraph",
  quote: "markdown-note-quote",
  text: {
    bold: "markdown-note-bold",
    code: "markdown-note-inline-code",
    italic: "markdown-note-italic",
    strikethrough: "markdown-note-strike"
  }
};

export const MarkdownNoteEditor = forwardRef(function MarkdownNoteEditor(
  {
    value,
    onChange,
    taskTitle,
    metadata,
    saveStatus,
    aiAction,
    disabledAi = false,
    showToolbar = false,
    onImproveWithAi
  }: MarkdownNoteEditorProps,
  ref: ForwardedRef<MarkdownNoteEditorHandle>
) {
  const [rawMode, setRawMode] = useState(false);
  const [rawValue, setRawValue] = useState(value);
  const editorRef = useRef<LexicalEditor | null>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contentEditableRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRawValue(value);
  }, [value]);

  useEffect(() => {
    if (!showToolbar) {
      setRawMode(false);
    }
  }, [showToolbar]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (rawMode) {
        rawTextareaRef.current?.focus();
        return;
      }
      editorRef.current?.focus();
      contentEditableRef.current?.focus();
    },
    insertMarkdownSnippet: (snippet: string) => {
      if (rawMode) {
        insertIntoTextarea(rawTextareaRef.current, rawValue, snippet, (nextValue) => {
          setRawValue(nextValue);
          onChange(nextValue);
        });
        return;
      }
      editorRef.current?.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const nodes = selection.extract();
          selection.insertNodes([$createTextNode(`${nodes.length ? "\n" : ""}${snippet}`)]);
        }
      });
    }
  }), [onChange, rawMode, rawValue]);

  const initialConfig = useMemo(() => ({
    namespace: "ReamMarkdownNoteEditor",
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode, CodeHighlightNode, HorizontalRuleNode],
    onError(error: Error) {
      console.error("Markdown note editor failed", error);
    },
    theme: noteEditorTheme,
    editorState: () => {
      $convertFromMarkdownString(value, NOTE_TRANSFORMERS, undefined, true);
    }
  }), []);

  function handleRawChange(nextValue: string) {
    setRawValue(nextValue);
    onChange(nextValue);
  }

  function handleRawKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "b") {
      event.preventDefault();
      wrapTextareaSelection(event.currentTarget, "**", "**", handleRawChange);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "i") {
      event.preventDefault();
      wrapTextareaSelection(event.currentTarget, "*", "*", handleRawChange);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      indentTextareaSelection(event.currentTarget, event.shiftKey, handleRawChange);
    }
  }

  return (
    <div className="markdown-note-shell">
      <header className="markdown-note-context">
        <div>
          <strong>{taskTitle}</strong>
          <p>{metadata.filter(Boolean).join(" · ")}</p>
        </div>
        <span className={`markdown-note-save-status is-${saveStatus}`}>{getSaveStatusLabel(saveStatus)}</span>
      </header>

      <LexicalComposer initialConfig={initialConfig}>
        <EditorRegistrationPlugin editorRef={editorRef} />
        <ExternalMarkdownSyncPlugin value={value} rawMode={rawMode} />
        <MarkdownChangePlugin onChange={onChange} rawMode={rawMode} />
        <PasteLinkPlugin />
        {showToolbar ? (
          <ToolbarPlugin
            aiAction={aiAction}
            disabledAi={disabledAi}
            onImproveWithAi={onImproveWithAi}
            rawMode={rawMode}
            setRawMode={(nextRawMode) => {
              setRawMode(nextRawMode);
              if (nextRawMode) {
                setRawValue(value);
                window.setTimeout(() => rawTextareaRef.current?.focus(), 0);
                return;
              }
              window.setTimeout(() => editorRef.current?.focus(), 0);
            }}
          />
        ) : null}

        {rawMode ? (
          <textarea
            aria-label="Raw Markdown note"
            className="markdown-note-raw"
            onChange={(event) => handleRawChange(event.target.value)}
            onKeyDown={handleRawKeyDown}
            placeholder="Add decisions, progress, blockers, or anything you may need later..."
            ref={rawTextareaRef}
            value={rawValue}
          />
        ) : (
          <div className="markdown-note-editor-wrap">
            <RichTextPlugin
              contentEditable={(
                <ContentEditable
                  aria-label="Task notes"
                  className="markdown-note-editor"
                  ref={contentEditableRef}
                />
              )}
              ErrorBoundary={LexicalErrorBoundary}
              placeholder={<div className="markdown-note-placeholder">Add decisions, progress, blockers, or anything you may need later...</div>}
            />
            <HistoryPlugin />
            <ListPlugin hasStrictIndent />
            <CheckListPlugin />
            <LinkPlugin />
            <HorizontalRulePlugin />
            <TabIndentationPlugin />
            <MarkdownShortcutPlugin transformers={NOTE_TRANSFORMERS} />
            <SlashCommandPlugin />
          </div>
        )}
      </LexicalComposer>
    </div>
  );
});

function EditorRegistrationPlugin({ editorRef }: { editorRef: React.MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [editor, editorRef]);

  return null;
}

function ExternalMarkdownSyncPlugin({ rawMode, value }: { rawMode: boolean; value: string }) {
  const [editor] = useLexicalComposerContext();
  const lastAppliedValueRef = useRef(value);

  useEffect(() => {
    if (rawMode || lastAppliedValueRef.current === value) {
      return;
    }

    let currentMarkdown = "";
    editor.getEditorState().read(() => {
      currentMarkdown = $convertToMarkdownString(NOTE_TRANSFORMERS, undefined, true);
    });
    if (currentMarkdown === value) {
      lastAppliedValueRef.current = value;
      return;
    }

    editor.update(() => {
      $convertFromMarkdownString(value, NOTE_TRANSFORMERS, undefined, true);
      lastAppliedValueRef.current = value;
    }, { tag: "ream-external-markdown-sync" });
  }, [editor, rawMode, value]);

  return null;
}

function MarkdownChangePlugin({ onChange, rawMode }: { onChange: (nextValue: string) => void; rawMode: boolean }) {
  const lastMarkdownRef = useRef<string | null>(null);

  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(editorState: EditorState, _editor: LexicalEditor, tags: Set<string>) => {
        if (rawMode || tags.has("ream-external-markdown-sync")) {
          return;
        }

        editorState.read(() => {
          const markdown = $convertToMarkdownString(NOTE_TRANSFORMERS, undefined, true);
          if (markdown !== lastMarkdownRef.current) {
            lastMarkdownRef.current = markdown;
            onChange(markdown);
          }
        });
      }}
    />
  );
}

function PasteLinkPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!(event instanceof ClipboardEvent)) {
        return false;
      }

      const url = event.clipboardData?.getData("text/plain").trim() ?? "";
      if (!URL_PATTERN.test(url)) {
        return false;
      }

      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        return false;
      }

      event.preventDefault();
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
      return true;
    },
    COMMAND_PRIORITY_HIGH
  ), [editor]);

  return null;
}

function ToolbarPlugin({
  aiAction,
  disabledAi,
  onImproveWithAi,
  rawMode,
  setRawMode
}: {
  aiAction: ReactNode;
  disabledAi: boolean;
  onImproveWithAi: () => void;
  rawMode: boolean;
  setRawMode: (rawMode: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [overflowOpen, setOverflowOpen] = useState(false);

  function formatText(format: TextFormatType) {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  }

  return (
    <div className="markdown-note-toolbar" aria-label="Note formatting toolbar">
      <button aria-label="Bold" onClick={() => formatText("bold")} title="Bold" type="button"><b>B</b></button>
      <button aria-label="Italic" onClick={() => formatText("italic")} title="Italic" type="button"><i>I</i></button>
      <button aria-label="Heading" onClick={() => formatBlock(editor, "h2")} title="Heading" type="button">H</button>
      <button aria-label="Bullet list" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} title="Bullet list" type="button">•</button>
      <button aria-label="Numbered list" onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)} title="Numbered list" type="button">1.</button>
      <button aria-label="Checklist" onClick={() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)} title="Checklist" type="button">☑</button>
      <button aria-label="Link" onClick={() => insertOrEditLink(editor)} title="Link" type="button">↗</button>
      <button aria-label="Inline code" onClick={() => formatText("code")} title="Inline code" type="button">`</button>
      <div className="markdown-note-overflow">
        <button aria-expanded={overflowOpen} aria-label="More note tools" onClick={() => setOverflowOpen((current) => !current)} title="More" type="button">+</button>
        {overflowOpen ? (
          <div className="markdown-note-overflow-menu">
            <button onClick={() => { formatBlock(editor, "h1"); setOverflowOpen(false); }} type="button">Heading 1</button>
            <button onClick={() => { formatBlock(editor, "h3"); setOverflowOpen(false); }} type="button">Heading 3</button>
            <button onClick={() => { formatBlock(editor, "quote"); setOverflowOpen(false); }} type="button">Quote</button>
            <button onClick={() => { formatBlock(editor, "code"); setOverflowOpen(false); }} type="button">Code block</button>
            <button onClick={() => { editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined); setOverflowOpen(false); }} type="button">Divider</button>
          </div>
        ) : null}
      </div>
      <button aria-pressed={rawMode} className="markdown-note-mode-toggle" onClick={() => setRawMode(!rawMode)} type="button">
        {rawMode ? "Formatted" : "Markdown"}
      </button>
      {aiAction ?? (
        <button className="markdown-note-ai-fallback" disabled={disabledAi} onClick={onImproveWithAi} type="button">Improve with AI</button>
      )}
    </div>
  );
}

class SlashCommandOption extends MenuOption {
  constructor(
    public readonly title: string,
    public readonly description: string,
    public readonly action: (editor: LexicalEditor) => void
  ) {
    super(title);
  }
}

const SLASH_OPTIONS = [
  new SlashCommandOption("Heading 1", "Large section heading", (editor) => formatBlock(editor, "h1")),
  new SlashCommandOption("Heading 2", "Medium section heading", (editor) => formatBlock(editor, "h2")),
  new SlashCommandOption("Heading 3", "Small section heading", (editor) => formatBlock(editor, "h3")),
  new SlashCommandOption("Bullet list", "Create a bulleted list", (editor) => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)),
  new SlashCommandOption("Numbered list", "Create a numbered list", (editor) => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)),
  new SlashCommandOption("Checklist", "Create an interactive checklist", (editor) => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)),
  new SlashCommandOption("Blockquote", "Capture quoted context", (editor) => formatBlock(editor, "quote")),
  new SlashCommandOption("Divider", "Insert a horizontal divider", (editor) => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)),
  new SlashCommandOption("Code block", "Insert a fenced code block", (editor) => formatBlock(editor, "code"))
];

function SlashCommandPlugin() {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const triggerFn = useBasicTypeaheadTriggerMatch("/", { allowWhitespace: true, maxLength: 24, minLength: 0 });
  const options = useMemo(() => {
    const normalizedQuery = query?.toLocaleLowerCase().trim() ?? "";
    if (!normalizedQuery) {
      return SLASH_OPTIONS;
    }
    return SLASH_OPTIONS.filter((option) => `${option.title} ${option.description}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [query]);

  return (
    <LexicalTypeaheadMenuPlugin
      onQueryChange={setQuery}
      onSelectOption={(option, textNodeContainingQuery, closeMenu, matchingString) => {
        editor.update(() => {
          removeSlashQuery(textNodeContainingQuery, matchingString);
        });
        option.action(editor);
        closeMenu();
      }}
      options={options}
      triggerFn={triggerFn}
      menuRenderFn={(anchorElementRef, { options: menuOptions, selectOptionAndCleanUp, selectedIndex }) => {
        if (!anchorElementRef.current || !menuOptions.length) {
          return null;
        }

        return createPortal(
          <div className="markdown-note-slash-menu">
            {menuOptions.map((option, index) => (
              <button
                className={selectedIndex === index ? "is-selected" : ""}
                key={option.key}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOptionAndCleanUp(option);
                }}
                type="button"
              >
                <strong>{option.title}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>,
          anchorElementRef.current
        );
      }}
    />
  );
}

function removeSlashQuery(textNode: TextNode | null, matchingString: string) {
  if (!textNode) {
    return;
  }

  const text = textNode.getTextContent();
  const suffix = `/${matchingString}`;
  if (text.endsWith(suffix)) {
    textNode.setTextContent(text.slice(0, -suffix.length));
  }
}

function formatBlock(editor: LexicalEditor, format: BlockFormat) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }

    const anchorNode = selection.anchor.getNode();
    const topLevelNode = anchorNode.getTopLevelElementOrThrow();
    if (!$isElementNode(topLevelNode)) {
      return;
    }

    const replacement = createBlockNode(format);
    topLevelNode.replace(replacement, true);
    replacement.selectStart();
  });
}

function createBlockNode(format: BlockFormat) {
  if (format === "h1" || format === "h2" || format === "h3") {
    return $createHeadingNode(format as HeadingTagType);
  }

  if (format === "quote") {
    return $createQuoteNode();
  }

  if (format === "code") {
    return $createCodeNode("text");
  }

  return $createParagraphNode();
}

function insertOrEditLink(editor: LexicalEditor) {
  const href = window.prompt("Paste a link");
  if (!href?.trim()) {
    return;
  }
  editor.dispatchCommand(TOGGLE_LINK_COMMAND, href.trim());
}

function insertIntoTextarea(textarea: HTMLTextAreaElement | null, currentValue: string, snippet: string, onChange: (nextValue: string) => void) {
  const selectionStart = textarea?.selectionStart ?? currentValue.length;
  const selectionEnd = textarea?.selectionEnd ?? selectionStart;
  const prefix = currentValue.slice(0, selectionStart);
  const suffix = currentValue.slice(selectionEnd);
  const needsLeadingBreak = prefix && !prefix.endsWith("\n") ? "\n" : "";
  const needsTrailingBreak = suffix && !suffix.startsWith("\n") ? "\n" : "";
  const nextValue = `${prefix}${needsLeadingBreak}${snippet}${needsTrailingBreak}${suffix}`;
  onChange(nextValue);
  window.setTimeout(() => {
    const cursorPosition = selectionStart + needsLeadingBreak.length + snippet.length;
    textarea?.focus();
    textarea?.setSelectionRange(cursorPosition, cursorPosition);
  }, 0);
}

function wrapTextareaSelection(textarea: HTMLTextAreaElement, prefix: string, suffix: string, onChange: (nextValue: string) => void) {
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const selectedText = textarea.value.slice(selectionStart, selectionEnd) || "text";
  const nextValue = `${textarea.value.slice(0, selectionStart)}${prefix}${selectedText}${suffix}${textarea.value.slice(selectionEnd)}`;
  onChange(nextValue);
  window.setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart + prefix.length, selectionStart + prefix.length + selectedText.length);
  }, 0);
}

function indentTextareaSelection(textarea: HTMLTextAreaElement, outdent: boolean, onChange: (nextValue: string) => void) {
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const value = textarea.value;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const lineEnd = value.indexOf("\n", selectionEnd);
  const selectedBlockEnd = lineEnd === -1 ? value.length : lineEnd;
  const selectedBlock = value.slice(lineStart, selectedBlockEnd);
  const nextBlock = selectedBlock.split("\n").map((line) => outdent ? line.replace(/^ {1,2}/, "") : `  ${line}`).join("\n");
  const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(selectedBlockEnd)}`;
  onChange(nextValue);
  window.setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart + (outdent ? -Math.min(2, selectionStart - lineStart) : 2), selectionEnd + (nextBlock.length - selectedBlock.length));
  }, 0);
}

function getSaveStatusLabel(status: NoteSaveStatus): string {
  if (status === "saving") {
    return "Saving...";
  }

  if (status === "saved") {
    return "Saved";
  }

  if (status === "offline") {
    return "Offline";
  }

  if (status === "failed") {
    return "Save failed";
  }

  return "Ready";
}
