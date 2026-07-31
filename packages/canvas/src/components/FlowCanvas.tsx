// React Flow canvas. Mirrors the store's WorkflowGraph into React Flow nodes/
// edges, rejects incompatible connections up front (edgeAllowed — same rule as
// CF005), and renders each node with its category accent + diagnostic badge.
import { useCallback, useMemo, useRef } from 'react';
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
  width?: number;  // phase group: measured container size
  height?: number;
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

// A phase renders as a titled GROUP container (M9): a translucent box sized to
// enclose its member nodes (which React Flow positions inside via parentId). The
// title bar names the phase; members are drawn as normal CFNodes on top.
function PhaseGroupNode({ data }: { data: NodeData }) {
  const { node, width, height } = data;
  const accent = ACCENT.phase;
  return (
    <div
      style={{
        width: width ?? 240, height: height ?? 120,
        borderRadius: '6px', border: `1px dashed ${accent}`,
        background: 'color-mix(in srgb, var(--cf-accent-phase, #6a9955) 7%, transparent)',
        fontFamily: TOKENS.uiFont, position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8, background: accent, border: 'none' }} />
      <div style={{ position: 'absolute', top: SPACE(1), left: SPACE(2), fontSize: '0.72em', color: accent, fontFamily: TOKENS.monoFont }}>
        <span aria-hidden>{CATEGORY_GLYPH.phase}</span> phase
      </div>
      <div style={{ position: 'absolute', top: SPACE(1), left: 0, right: 0, textAlign: 'center', fontWeight: 600, color: TOKENS.text }}>
        {node.kind === 'phase' ? node.data.title || '(untitled phase)' : ''}
      </div>
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8, background: accent, border: 'none' }} />
    </div>
  );
}

const nodeTypes = { cf: CFNode, phaseGroup: PhaseGroupNode };

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

  // Origin (top-left absolute position) of each phase container, so a child drag —
  // which React Flow reports relative to the parent — can be converted back to the
  // absolute coordinate the store holds. Populated while building rfNodes.
  const boxOrigin = useRef(new Map<string, { x: number; y: number }>());
  const parentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of state.graph.nodes) if (n.parentId) m.set(n.id, n.parentId);
    return m;
  }, [state.graph.nodes]);

  const rfNodes: RFNode<NodeData>[] = useMemo(() => {
    const nodes = state.graph.nodes;
    const origins = new Map<string, { x: number; y: number }>();
    // Members grouped by their phase parent, so each phase renders as a container
    // box sized to enclose its members (React Flow parent/child: parent listed first,
    // child positions relative to the parent, parent given an explicit size).
    const PAD = 24; const TITLE_H = 28; const NODE_W = 180; const NODE_H = 64;
    const membersOf = new Map<string, typeof nodes>();
    for (const n of nodes) {
      if (n.parentId) (membersOf.get(n.parentId) ?? membersOf.set(n.parentId, []).get(n.parentId)!).push(n);
    }
    // Container geometry per phase: bounding box of its members' absolute positions.
    const box = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const [pid, members] of membersOf) {
      const xs = members.map((m) => m.position.x);
      const ys = members.map((m) => m.position.y);
      const minX = Math.min(...xs); const minY = Math.min(...ys);
      const maxX = Math.max(...xs); const maxY = Math.max(...ys);
      box.set(pid, { x: minX - PAD, y: minY - TITLE_H - PAD, w: (maxX - minX) + NODE_W + PAD * 2, h: (maxY - minY) + NODE_H + TITLE_H + PAD * 2 });
      origins.set(pid, { x: minX - PAD, y: minY - TITLE_H - PAD });
    }
    boxOrigin.current = origins;
    const out: RFNode<NodeData>[] = [];
    // Phase containers first (React Flow requires parents before children).
    for (const n of nodes) {
      if (n.kind !== 'phase') continue;
      const b = box.get(n.id);
      out.push({
        id: n.id, type: 'phaseGroup',
        position: b ? { x: b.x, y: b.y } : n.position,
        selected: n.id === state.selectedNodeId,
        data: { node: n, worst: worstByNode.get(n.id), width: b?.w, height: b?.h },
        style: { width: b?.w, height: b?.h },
      });
    }
    // Then the rest; a phase member is positioned relative to its container.
    for (const n of nodes) {
      if (n.kind === 'phase') continue;
      const b = n.parentId ? box.get(n.parentId) : undefined;
      out.push({
        id: n.id, type: 'cf',
        position: b ? { x: n.position.x - b.x, y: n.position.y - b.y } : n.position,
        ...(n.parentId && b ? { parentId: n.parentId, extent: 'parent' as const } : {}),
        selected: n.id === state.selectedNodeId,
        data: { node: n, worst: worstByNode.get(n.id) },
      });
    }
    return out;
  }, [state.graph.nodes, state.selectedNodeId, worstByNode]);

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
          // A phase member's position is reported relative to its container; the
          // store holds absolute coordinates, so add back the container origin.
          const pid = parentOf.get(ch.id);
          const origin = pid ? boxOrigin.current.get(pid) : undefined;
          const abs = origin ? { x: ch.position.x + origin.x, y: ch.position.y + origin.y } : ch.position;
          store.moveNode(ch.id, abs);
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
        <MiniMap
          nodeColor={minimapColor}
          pannable
          zoomable
          // React Flow's minimap defaults to a light background; theme it so it
          // doesn't render as a white box over the dark canvas.
          style={{ background: TOKENS.surfaceRaised }}
          maskColor="rgba(0,0,0,0.55)"
        />
        <Controls />
      </ReactFlow>
    </div>
  );
}
