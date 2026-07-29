// React binding for EditorStore via useSyncExternalStore. Components call
// useEditor(store) to re-render on any store change and read the live state.
import { useSyncExternalStore } from 'react';
import type { EditorStore, EditorState } from './store.js';

export function useEditor(store: EditorStore): EditorState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
