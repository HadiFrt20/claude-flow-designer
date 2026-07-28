// Pure, framework-agnostic graph editor store. All canvas mutations go through
// here so they are unit-testable without React. Holds an undo/redo history of
// immutable WorkflowGraph snapshots. The React layer subscribes and re-renders.
import type { WorkflowGraph, Edge, WorkflowNode, NodeKind, RuleId } from '@clauflow/core';
import { validateGraph, exportGate, emptyGraph } from '@clauflow/core';
import type { Diagnostic } from '@clauflow/core';

export interface EditorState {
  graph: WorkflowGraph;
  selectedNodeId: string | null;
}

type Listener = () => void;

const HISTORY_LIMIT = 100;

function clone(graph: WorkflowGraph): WorkflowGraph {
  return structuredClone(graph);
}

export class EditorStore {
  private past: WorkflowGraph[] = [];
  private future: WorkflowGraph[] = [];
  private graph: WorkflowGraph;
  private selectedNodeId: string | null = null;
  private listeners = new Set<Listener>();
  private clipboard: WorkflowNode | null = null;
  // Cached immutable snapshot for useSyncExternalStore — a stable reference is
  // required (a fresh object each call causes an infinite render loop). Rebuilt
  // only when graph or selection actually changes.
  private snapshot: EditorState;

  constructor(initial?: WorkflowGraph) {
    this.graph = initial ? clone(initial) : emptyGraph('Untitled', 'untitled');
    this.snapshot = { graph: this.graph, selectedNodeId: this.selectedNodeId };
  }

  // --- subscription (React useSyncExternalStore) ---------------------------
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EditorState => this.snapshot;

  private emit(): void {
    this.snapshot = { graph: this.graph, selectedNodeId: this.selectedNodeId };
    for (const l of this.listeners) l();
  }

  /** Commit a new graph onto the undo stack (unless it's a no-op). */
  private commit(next: WorkflowGraph): void {
    if (next === this.graph) return;
    this.past.push(this.graph);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.graph = next;
    this.emit();
  }

  // --- read helpers ---------------------------------------------------------
  get current(): WorkflowGraph {
    return this.graph;
  }
  get selected(): WorkflowNode | null {
    return this.graph.nodes.find((n) => n.id === this.selectedNodeId) ?? null;
  }
  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }

  // --- selection (not part of undo history) --------------------------------
  select(nodeId: string | null): void {
    if (this.selectedNodeId === nodeId) return;
    this.selectedNodeId = nodeId;
    this.emit();
  }

  // --- node ops -------------------------------------------------------------
  addNode(node: WorkflowNode): void {
    const next = clone(this.graph);
    next.nodes.push(node);
    this.commit(next);
    this.select(node.id);
  }

  moveNode(nodeId: string, position: { x: number; y: number }): void {
    const next = clone(this.graph);
    const node = next.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.position = position;
    this.commit(next);
  }

  /** Patch a node's data (shallow merge). Used by property panels. */
  updateNodeData(nodeId: string, patch: Record<string, unknown>): void {
    const next = clone(this.graph);
    const node = next.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.data = { ...node.data, ...patch } as WorkflowNode['data'];
    this.commit(next);
  }

  updateNodeLabel(nodeId: string, label: string): void {
    const next = clone(this.graph);
    const node = next.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.label = label;
    this.commit(next);
  }

  deleteNode(nodeId: string): void {
    const next = clone(this.graph);
    next.nodes = next.nodes.filter((n) => n.id !== nodeId);
    next.edges = next.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    this.commit(next);
    if (this.selectedNodeId === nodeId) this.select(null);
  }

  // --- edge ops -------------------------------------------------------------
  connect(source: string, target: string): void {
    const id = `${source}->${target}`;
    if (this.graph.edges.some((e) => e.id === id)) return;
    const next = clone(this.graph);
    next.edges.push({ id, source, target });
    this.commit(next);
  }

  disconnect(edgeId: string): void {
    const next = clone(this.graph);
    next.edges = next.edges.filter((e) => e.id !== edgeId);
    this.commit(next);
  }

  // --- settings + meta ------------------------------------------------------
  updateSettings(patch: Partial<WorkflowGraph['settings']>): void {
    const next = clone(this.graph);
    next.settings = { ...next.settings, ...patch };
    this.commit(next);
  }

  updateMeta(patch: Partial<WorkflowGraph['meta']>): void {
    const next = clone(this.graph);
    next.meta = { ...next.meta, ...patch };
    this.commit(next);
  }

  /** Acknowledge (or un-ack) a warning rule id — persisted in meta.ackedWarnings. */
  toggleAck(ruleId: RuleId): void {
    const next = clone(this.graph);
    const acked = new Set(next.meta.ackedWarnings ?? []);
    if (acked.has(ruleId)) acked.delete(ruleId);
    else acked.add(ruleId);
    next.meta.ackedWarnings = [...acked];
    this.commit(next);
  }

  // --- copy / paste ---------------------------------------------------------
  copy(nodeId?: string): void {
    const id = nodeId ?? this.selectedNodeId;
    const node = this.graph.nodes.find((n) => n.id === id);
    if (node) this.clipboard = structuredClone(node);
  }

  paste(offset = { x: 24, y: 24 }): void {
    if (!this.clipboard) return;
    const base = this.clipboard;
    const newId = this.freshId(base.kind);
    const node = {
      ...structuredClone(base),
      id: newId,
      position: { x: base.position.x + offset.x, y: base.position.y + offset.y },
    } as WorkflowNode;
    this.addNode(node);
  }

  hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  /** Deterministic fresh node id: `<prefix>-<n>` where prefix is the kind's tail. */
  freshId(kind: NodeKind): string {
    const prefix = kind.split('.')[1] ?? kind;
    const ids = new Set(this.graph.nodes.map((n) => n.id));
    let i = 1;
    while (ids.has(`${prefix}-${i}`)) i++;
    return `${prefix}-${i}`;
  }

  // --- undo / redo ----------------------------------------------------------
  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.unshift(this.graph);
    this.graph = prev;
    this.emit();
  }

  redo(): void {
    const next = this.future.shift();
    if (!next) return;
    this.past.push(this.graph);
    this.graph = next;
    this.emit();
  }

  // --- replace whole graph (import / new) — clears history ------------------
  replaceGraph(graph: WorkflowGraph): void {
    this.past = [];
    this.future = [];
    this.graph = clone(graph);
    this.selectedNodeId = null;
    this.emit();
  }

  // --- validation views -----------------------------------------------------
  diagnostics(): Diagnostic[] {
    return validateGraph(this.graph);
  }

  /** Export-gate status for the current graph (honours meta.ackedWarnings). */
  gate(): { ok: boolean; blocking: Diagnostic[] } {
    return exportGate(this.diagnostics(), this.graph.meta.ackedWarnings ?? []);
  }

  /** Apply a quick fix's graph transform (the fix returns a new graph). */
  applyQuickFix(fix: { apply(g: WorkflowGraph): WorkflowGraph }): void {
    this.commit(fix.apply(clone(this.graph)));
  }
}

export type { Edge };
