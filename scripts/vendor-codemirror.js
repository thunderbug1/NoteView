const esbuild = require('esbuild');
const path = require('path');

const src = `
import {EditorView, basicSetup} from "codemirror";
import {markdown} from "@codemirror/lang-markdown";
import {languages} from "@codemirror/language-data";
import {foldService} from "@codemirror/language";
import {ViewPlugin, Decoration, WidgetType, keymap, placeholder} from "@codemirror/view";
import {EditorState, StateField, Prec} from "@codemirror/state";
import {unifiedMergeView} from "@codemirror/merge";
import {indentWithTab} from "@codemirror/commands";
import {autocompletion, completionKeymap, closeBracketsKeymap} from "@codemirror/autocomplete";

window.CodeMirror = {
    EditorView,
    basicSetup,
    Prec,
    keymap,
    markdown,
    languages,
    ViewPlugin,
    Decoration,
    WidgetType,
    StateField,
    unifiedMergeView,
    indentWithTab,
    placeholder,
    EditorState,
    autocompletion,
    completionKeymap,
    closeBracketsKeymap,
    foldService
};

window.CodeMirrorReady = true;
window.dispatchEvent(new Event('CodeMirrorReady'));
`;

esbuild.build({
  stdin: {
    contents: src,
    resolveDir: __dirname,
  },
  bundle: true,
  outfile: path.join(__dirname, '../vendor/codemirror.js'),
  format: 'iife',
  minify: true,
}).then(() => {
  console.log('CodeMirror bundled successfully!');
}).catch(() => process.exit(1));
