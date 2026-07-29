// React Flow canvas. Mirrors the store's WorkflowGraph into React Flow nodes/
// edges, rejects incompatible connections up front (edgeAllowed — same rule as
// CF005), and renders each node with its category accent + diagnostic badge.
import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  Handle,
  Position,
  type Node as RFNode,
  type Edge as RFEdge,
  type Connection,
  type NodeChange,
  applyNodeChanges,
} from '@xyflow/react';
import { useEditor } from '../useEditor.js';
import type { EditorStore } from '../store.js';
import { edgeAllowed, isRoot, type WorkflowNode } from '@clauflow/core';
import { ACCENT, CATEGORY_GLYPH, categoryOf, TOKENS, SPACE, SEVERITY_ICON, SEVERITY_COLOR } from '../tokens.js';

interface NodeData extends Record<string, unknown> {
  node: WorkflowNode;
  worst?: 'error' | 'warn';
}

function CFNode({ data }: { data: NodeData }) {
  const { node, worst } = data;
  const cat = categoryOf(node.kind);
  // workflow.meta is the entry point (source only); output.return is a terminal
  // (target only); every other kind can both receive and emit an edge.
  const hasTarget = !isRoot(node);
  const hasSource = node.kind !== 'output.return';
  const dotStyle = { width: 8, height: 8, background: ACCENT[cat], border: 'none' };
  return (
    <div
      style={{
        minWidth: 140, borderRadius: '4px', border: `1px solid ${TOKENS.border}`,
        borderLeft: `2px solid ${ACCENT[cat]}`, background: TOKENS.surfaceRaised, color: TOKENS.text,
        fontFamily: TOKENS.uiFont, padding: SPACE(2), position: 'relative',
      }}
    >
      {hasTarget && <Handle type="target" position={Position.Left} style={dotStyle} />}
      {worst && (
        <span
          aria-label={worst === 'error' ? 'has errors' : 'has warnings'}
          style={{ position: 'absolute', top: -8, right: -8, color: SEVERITY_COLOR[worst], background: TOKENS.surface, borderRadius: '50%', fontSize: '0.75em', padding: '0 3px' }}
        >
          {SEVERITY_ICON[worst]}
        </span>
      )}
      <div style={{ fontFamily: TOKENS.monoFont, fontSize: '0.72em', color: TOKENS.textMuted }}>
        <span aria-hidden>{CATEGORY_GLYPH[cat]}</span> {node.kind}
      </div>
      <div style={{ fontWeight: 600 }}>{node.label || '(unnamed)'}</div>
      {hasSource && <Handle type="source" position={Position.Right} style={dotStyle} />}
    </div>
  );
}

const nodeTypes = { cf: CFNode };

export function FlowCanvas({ store }: { store: EditorStore }) {
  const state = useEditor(store);
  const diags = store.diagnostics();

  const worstByNode = useMemo(() => {
    const m = new Map<string, 'error' | 'warn'>();
    for (const d of diags) {
      if (!d.nodeId) continue;
      if (d.severity === 'error') m.set(d.nodeId, 'error');
      else if (d.severity === 'warn' && m.get(d.nodeId) !== 'error') m.set(d.nodeId, 'warn');
    }
    return m;
  }, [diags]);

  const rfNodes: RFNode<NodeData>[] = useMemo(
    () =>
      state.graph.nodes.map((n) => ({
        id: n.id,
        type: 'cf',
        position: n.position,
        selected: n.id === state.selectedNodeId,
        data: { node: n, worst: worstByNode.get(n.id) },
      })),
    [state.graph.nodes, state.selectedNodeId, worstByNode],
  );

  const rfEdges: RFEdge[] = useMemo(
    () => state.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label })),
    [state.graph.edges],
  );

  const byId = useMemo(() => new Map(state.graph.nodes.map((n) => [n.id, n])), [state.graph.nodes]);

  const isValidConnection = useCallback(
    (c: Connection | RFEdge) => {
      const s = byId.get(c.source!);
      const t = byId.get(c.target!);
      return !!s && !!t && edgeAllowed(s.kind, t.kind);
    },
    [byId],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && isValidConnection(c)) store.connect(c.source, c.target);
    },
    [store, isValidConnection],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Persist position changes back to the store; ignore RF-internal churn.
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position && !ch.dragging) {
          store.moveNode(ch.id, ch.position);
        } else if (ch.type === 'select' && ch.selected) {
          store.select(ch.id);
        } else if (ch.type === 'remove') {
          store.deleteNode(ch.id);
        }
      }
      // Let RF compute transient drag state for smoothness.
      void applyNodeChanges(changes, rfNodes);
    },
    [store, rfNodes],
  );

  const minimapColor = useCallback((n: RFNode) => ACCENT[categoryOf((n.data as NodeData).node.kind)], []);

  return (
    <div style={{ width: '100%', height: '100%' }} aria-label="Workflow canvas">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => store.select(n.id)}
        onPaneClick={() => store.select(null)}
        fitView
      >
        <Background />
        <MiniMap nodeColor={minimapColor} pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}
