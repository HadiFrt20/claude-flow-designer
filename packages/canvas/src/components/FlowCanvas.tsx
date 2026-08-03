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

/**
 * The array a fan-out maps over, as a short honest label: `args`, a node id, plus an
 * optional `.field`. The concurrency WIDTH is dynamic (`SOURCE.map(...)` at runtime),
 * so we show what it fans over (`× list.dims`), never a fake fixed count.
 */
function fanOutSourceLabel(node: WorkflowNode): string {
  if (node.kind !== 'parallel' && node.kind !== 'pipeline') return '';
  const base = node.data.source === 'args' || !node.data.source ? 'args' : node.data.source;
  return node.data.sourceField ? `${base}.${node.data.sourceField}` : base;
}

/**
 * A parallel/pipeline node renders as a visible FAN-OUT (M10): the main card plus an
 * internal diagram of one source dot forking into concurrent item-agent lanes, so a
 * step that is really "N agents at once" looks wide instead of like one sequential
 * box. This is PURELY a rendering of the single graph node — no extra graph nodes or
 * edges exist, so codegen/round-trip/validation are untouched.
 */
function FanOutNode({ data }: { data: NodeData }) {
  const { node, worst } = data;
  const cat = categoryOf(node.kind); // 'pipeline' accent for both fan-out kinds
  const accent = ACCENT[cat];
  const dotStyle = { width: 8, height: 8, background: accent, border: 'none' };
  const src = fanOutSourceLabel(node);
  const concurrent = node.kind === 'parallel'; // pipeline is sequential-per-item; parallel is concurrent
  // Three lanes convey "many"; the third is an ellipsis chip so we never imply a
  // fixed count. Geometry for the little SVG fork.
  const laneYs = [16, 34, 52];
  return (
    <div
      style={{
        minWidth: 180, borderRadius: '4px', border: `1px solid ${TOKENS.border}`,
        borderLeft: `2px solid ${accent}`, background: TOKENS.surfaceRaised, color: TOKENS.text,
        fontFamily: TOKENS.uiFont, padding: SPACE(2), position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={dotStyle} />
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
      {/* concurrency badge — the honest "this is N at once, over <source>" signal */}
      <div style={{ fontSize: '0.68em', color: accent, marginTop: SPACE(1), fontFamily: TOKENS.monoFont }}>
        {concurrent ? '⇉ concurrent' : '→ sequential'} · one agent × {src}
      </div>
      {/* fan diagram: a source dot forking into concurrent item-agent lanes */}
      <svg width="100%" height="64" style={{ marginTop: SPACE(1), overflow: 'visible' }} aria-hidden>
        {laneYs.map((y, i) => (
          <path key={i} d={`M 6 6 C 40 6, 40 ${y}, 74 ${y}`} stroke={accent} strokeWidth={1} fill="none" opacity={0.6} />
        ))}
        <circle cx={6} cy={6} r={3} fill={accent} />
        {laneYs.map((y, i) => (
          <g key={i}>
            <rect x={74} y={y - 8} width={72} height={16} rx={2} fill={TOKENS.surface} stroke={accent} strokeWidth={0.75} opacity={i === 2 ? 0.5 : 1} />
            <text x={80} y={y + 4} fontSize={9} fill={TOKENS.textMuted} fontFamily={TOKENS.monoFont}>
              {i === 2 ? '… × items' : `agent ${node.kind === 'parallel' ? node.data.itemVar ?? 'item' : 'item'}`}
            </text>
          </g>
        ))}
      </svg>
      <Handle type="source" position={Position.Right} style={dotStyle} />
    </div>
  );
}

/** One lane's label for a fanout branch: a `map` lane shows `× <source>` (dynamic
 *  width); a `thunk` lane shows its opts.label or a generic "agent". */
function fanoutLaneLabel(branch: Extract<WorkflowNode, { kind: 'fanout' }>['data']['branches'][number]): string {
  if (branch.kind === 'map') {
    const base = branch.source === 'args' || !branch.source ? 'args' : branch.source;
    return `× ${branch.sourceField ? `${base}.${branch.sourceField}` : base}`;
  }
  return branch.label ? branch.label : 'agent';
}

/**
 * A `fanout` node (M10 static-array `parallel([...])`) renders one lane PER BRANCH — a
 * literal thunk is a concrete lane, a `...map()` spread is a `× <source>` lane (dynamic
 * width). This makes the heterogeneous concurrent group (2–16 agents) visible instead of
 * one box. Purely a rendering of the single node's `branches[]`; no extra graph nodes.
 */
function FanoutNode({ data }: { data: NodeData }) {
  const { node, worst } = data;
  if (node.kind !== 'fanout') return null;
  const accent = ACCENT.pipeline; // fan-out family accent
  const dotStyle = { width: 8, height: 8, background: accent, border: 'none' };
  const branches = node.data.branches;
  const rowH = 16;
  const shown = branches.slice(0, 6); // cap the drawn lanes; note overflow below
  return (
    <div
      style={{
        minWidth: 200, borderRadius: '4px', border: `1px solid ${TOKENS.border}`,
        borderLeft: `2px solid ${accent}`, background: TOKENS.surfaceRaised, color: TOKENS.text,
        fontFamily: TOKENS.uiFont, padding: SPACE(2), position: 'relative',
      }}
    >
      <Handle type="target" position={Position.Left} style={dotStyle} />
      {worst && (
        <span
          aria-label={worst === 'error' ? 'has errors' : 'has warnings'}
          style={{ position: 'absolute', top: -8, right: -8, color: SEVERITY_COLOR[worst], background: TOKENS.surface, borderRadius: '50%', fontSize: '0.75em', padding: '0 3px' }}
        >
          {SEVERITY_ICON[worst]}
        </span>
      )}
      <div style={{ fontFamily: TOKENS.monoFont, fontSize: '0.72em', color: TOKENS.textMuted }}>
        <span aria-hidden>{CATEGORY_GLYPH.pipeline}</span> fanout
      </div>
      <div style={{ fontWeight: 600 }}>{node.label || '(unnamed)'}</div>
      <div style={{ fontSize: '0.68em', color: accent, marginTop: SPACE(1), fontFamily: TOKENS.monoFont }}>
        ⇉ concurrent · {branches.length} {branches.length === 1 ? 'lane' : 'lanes'}
        {node.data.mode === 'promiseAll' ? ' (Promise.all)' : ''}
      </div>
      {/* one row per branch: source dot forking to each lane */}
      <svg width="100%" height={Math.max(1, shown.length) * rowH + 8} style={{ marginTop: SPACE(1), overflow: 'visible' }} aria-hidden>
        <circle cx={6} cy={8} r={3} fill={accent} />
        {shown.map((b, i) => {
          const y = 8 + i * rowH;
          return (
            <g key={i}>
              <path d={`M 6 8 C 40 8, 40 ${y}, 74 ${y}`} stroke={accent} strokeWidth={1} fill="none" opacity={0.6} />
              <rect x={74} y={y - 7} width={110} height={14} rx={2} fill={TOKENS.surface} stroke={accent} strokeWidth={0.75} />
              <text x={79} y={y + 3} fontSize={9} fill={TOKENS.textMuted} fontFamily={TOKENS.monoFont}>
                {fanoutLaneLabel(b).slice(0, 18)}
              </text>
            </g>
          );
        })}
      </svg>
      {branches.length > shown.length && (
        <div style={{ fontSize: '0.64em', color: TOKENS.textMuted, fontFamily: TOKENS.monoFont }}>
          +{branches.length - shown.length} more lanes
        </div>
      )}
      <Handle type="source" position={Position.Right} style={dotStyle} />
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

const nodeTypes = { cf: CFNode, phaseGroup: PhaseGroupNode, fanOut: FanOutNode, fanoutLanes: FanoutNode };

/** The React Flow node-type name for a workflow node kind. */
function rfTypeOf(kind: WorkflowNode['kind']): 'cf' | 'phaseGroup' | 'fanOut' | 'fanoutLanes' {
  if (kind === 'phase') return 'phaseGroup';
  if (kind === 'parallel' || kind === 'pipeline') return 'fanOut';
  if (kind === 'fanout') return 'fanoutLanes';
  return 'cf';
}

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

  const parentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of state.graph.nodes) if (n.parentId) m.set(n.id, n.parentId);
    return m;
  }, [state.graph.nodes]);

  // Container geometry per phase: the bounding box of its members' absolute
  // positions, padded. React Flow renders a phase as this box (parent node) and
  // positions members relative to its top-left origin. Computed once and read by
  // both rfNodes (rendering) and onNodesChange (converting a child drag back to
  // absolute) — no ref mutation during render (a React correctness smell).
  const boxes = useMemo(() => {
    // NODE_W/NODE_H reserve room for the widest+tallest member so the container
    // encloses it. A fan-out member (parallel/pipeline) carries an internal fan
    // diagram, so it's taller than a plain node — size for that.
    const PAD = 24; const TITLE_H = 28; const NODE_W = 220; const NODE_H = 150;
    const membersOf = new Map<string, typeof state.graph.nodes>();
    for (const n of state.graph.nodes) {
      if (n.parentId) (membersOf.get(n.parentId) ?? membersOf.set(n.parentId, []).get(n.parentId)!).push(n);
    }
    const box = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const [pid, members] of membersOf) {
      const xs = members.map((m) => m.position.x);
      const ys = members.map((m) => m.position.y);
      const minX = Math.min(...xs); const minY = Math.min(...ys);
      const maxX = Math.max(...xs); const maxY = Math.max(...ys);
      box.set(pid, { x: minX - PAD, y: minY - TITLE_H - PAD, w: (maxX - minX) + NODE_W + PAD * 2, h: (maxY - minY) + NODE_H + TITLE_H + PAD * 2 });
    }
    return box;
  }, [state.graph.nodes]);

  const rfNodes: RFNode<NodeData>[] = useMemo(() => {
    const nodes = state.graph.nodes;
    const box = boxes;
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
        id: n.id, type: rfTypeOf(n.kind),
        position: b ? { x: n.position.x - b.x, y: n.position.y - b.y } : n.position,
        ...(n.parentId && b ? { parentId: n.parentId, extent: 'parent' as const } : {}),
        selected: n.id === state.selectedNodeId,
        data: { node: n, worst: worstByNode.get(n.id) },
      });
    }
    return out;
  }, [state.graph.nodes, state.selectedNodeId, worstByNode, boxes]);

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
          const origin = pid ? boxes.get(pid) : undefined;
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
    [store, rfNodes, parentOf, boxes],
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
