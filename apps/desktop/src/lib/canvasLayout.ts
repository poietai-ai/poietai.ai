import type { CanvasNodeType, CanvasPhase, CanvasNodeData } from '../types/canvas';
import type { Node } from '@xyflow/react';

// ── Constants ──────────────────────────────────────────────────────────
/** Horizontal gap between nodes (edge-to-edge). */
export const H_GAP = 40;
/** Vertical gap between swim lanes. */
export const V_GAP = 60;

// ── Types ──────────────────────────────────────────────────────────────
export interface LayoutState {
  /** lane → next available x coordinate */
  nextX: Record<string, number>;
  /** lane → y offset */
  laneY: Record<string, number>;
  /** lane → tallest node placed so far */
  laneTallest: Record<string, number>;
  /** ordered lane IDs (default lane is always first) */
  laneOrder: string[];
}

export interface NodeSize {
  width: number;
  height: number;
}

export interface PlacedNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Default lane key ───────────────────────────────────────────────────
const DEFAULT_LANE = '';

// ── Width lookup (derived from Tailwind classes used by each node) ────
const WIDTH_BY_TYPE: Partial<Record<CanvasNodeType, number>> = {
  thought: 384,         // max-w-sm
  agent_message: 384,   // max-w-sm
  file_read: 384,       // max-w-sm
  file_edit: 384,       // max-w-sm
  file_write: 384,      // max-w-sm
  bash_command: 384,    // max-w-sm
  awaiting_user: 384,   // max-w-sm
  plan_task: 240,       // narrower ghost nodes
  validate_result: 320, // max-w-xs
  qa_result: 320,
  security_result: 320,
  review_synthesis: 384,
  status_update: 320,   // max-w-xs
  fan_out: 300,
  fan_in: 300,
};

const DEFAULT_WIDTH = 384;

// Base heights per node type (before content adjustment)
const BASE_HEIGHT: Partial<Record<CanvasNodeType, number>> = {
  thought: 80,
  agent_message: 80,
  file_read: 56,
  file_edit: 56,
  file_write: 56,
  bash_command: 56,
  status_update: 40,
  fan_out: 80,
  fan_in: 60,
  validate_result: 80,
  qa_result: 80,
  security_result: 80,
  review_synthesis: 120,
  plan_task: 60,
  awaiting_user: 60,
};

const DEFAULT_BASE_HEIGHT = 60;
const LINE_HEIGHT_PX = 18;
const CHARS_PER_LINE = 50;
const ITEM_HEIGHT_PX = 22;
const MAX_HEIGHT = 400;

// ── Public API ─────────────────────────────────────────────────────────

export function createLayoutState(): LayoutState {
  return {
    nextX: { [DEFAULT_LANE]: 0 },
    laneY: { [DEFAULT_LANE]: 80 },
    laneTallest: { [DEFAULT_LANE]: 0 },
    laneOrder: [DEFAULT_LANE],
  };
}

export function estimateNodeSize(
  nodeType: CanvasNodeType,
  content?: string,
  items?: string[],
): NodeSize {
  const width = WIDTH_BY_TYPE[nodeType] ?? DEFAULT_WIDTH;
  let height = BASE_HEIGHT[nodeType] ?? DEFAULT_BASE_HEIGHT;

  // Adjust height by content length
  if (content && content.length > 0) {
    const lines = Math.ceil(content.length / CHARS_PER_LINE);
    height += Math.max(0, lines - 1) * LINE_HEIGHT_PX;
  }

  // Adjust height by grouped items
  if (items && items.length > 1) {
    height += (items.length - 1) * ITEM_HEIGHT_PX;
  }

  return { width, height: Math.min(height, MAX_HEIGHT) };
}

/**
 * Place a node in the given lane, returning its position and advancing the layout cursor.
 * Mutates `layout` in place.
 */
export function placeNode(
  layout: LayoutState,
  laneId: string,
  nodeType: CanvasNodeType,
  content?: string,
  items?: string[],
): PlacedNode {
  const lane = laneId in layout.nextX ? laneId : DEFAULT_LANE;

  const x = layout.nextX[lane] ?? 0;
  const y = layout.laneY[lane] ?? 80;
  const size = estimateNodeSize(nodeType, content, items);

  layout.nextX[lane] = x + size.width + H_GAP;
  layout.laneTallest[lane] = Math.max(layout.laneTallest[lane] ?? 0, size.height);

  return { x, y, ...size };
}

/**
 * Place a fan-out node and create swim lanes for each group.
 * Returns the fan-out node's position.
 */
export function placeFanOut(
  layout: LayoutState,
  groups: { group_id: string; agent_role: string }[],
): PlacedNode {
  // Fan-out goes at the max x across all lanes
  const maxX = Math.max(...Object.values(layout.nextX), 0);
  const defaultY = layout.laneY[DEFAULT_LANE] ?? 80;

  const fanSize = estimateNodeSize('fan_out');
  const fanX = maxX;
  const fanY = defaultY;

  // Advance default lane past the fan-out node
  layout.nextX[DEFAULT_LANE] = fanX + fanSize.width + H_GAP;

  // Create swim lanes centered around the fan-out Y
  const laneHeight = 160; // estimated height per lane
  const totalHeight = groups.length * laneHeight + (groups.length - 1) * V_GAP;
  const startY = fanY - totalHeight / 2 + laneHeight / 2;

  const laneStartX = fanX + fanSize.width + H_GAP;

  groups.forEach((g, idx) => {
    const laneY = startY + idx * (laneHeight + V_GAP);
    layout.nextX[g.group_id] = laneStartX;
    layout.laneY[g.group_id] = laneY;
    layout.laneTallest[g.group_id] = 0;
    if (!layout.laneOrder.includes(g.group_id)) {
      layout.laneOrder.push(g.group_id);
    }
  });

  return { x: fanX, y: fanY, ...fanSize };
}

/**
 * Place a fan-in node that merges multiple lanes back into the default lane.
 * Returns the fan-in node's position.
 */
export function placeFanIn(
  layout: LayoutState,
  groupIds: string[],
): PlacedNode {
  // Fan-in goes at the max x across all active lanes
  const relevantLanes = [DEFAULT_LANE, ...groupIds];
  const maxX = Math.max(
    ...relevantLanes.map((id) => layout.nextX[id] ?? 0),
    0,
  );
  const defaultY = layout.laneY[DEFAULT_LANE] ?? 80;

  const fanSize = estimateNodeSize('fan_in');
  const fanX = maxX;
  const fanY = defaultY;

  // Clean up swim lanes
  for (const gid of groupIds) {
    delete layout.nextX[gid];
    delete layout.laneY[gid];
    delete layout.laneTallest[gid];
    layout.laneOrder = layout.laneOrder.filter((id) => id !== gid);
  }

  // Advance default lane past the fan-in node
  layout.nextX[DEFAULT_LANE] = fanX + fanSize.width + H_GAP;

  return { x: fanX, y: fanY, ...fanSize };
}

// ── Phase inference & grouping ────────────────────────────────────────

/** Map a node type to a canvas phase for old canvases without phase data. */
export function inferPhase(nodeType: CanvasNodeType): CanvasPhase {
  switch (nodeType) {
    case 'plan_task':        return 'plan';
    case 'fan_out':          return 'build';
    case 'fan_in':           return 'build';
    case 'validate_result':  return 'validate';
    case 'qa_result':        return 'qa';
    case 'security_result':  return 'security';
    case 'review_synthesis': return 'ship';
    default:                 return 'build';
  }
}

export const PHASE_COLORS: Record<CanvasPhase, { bg: string; border: string; label: string }> = {
  brief:    { bg: 'rgba(14,165,233,0.06)',  border: 'rgba(14,165,233,0.25)',  label: 'Brief' },
  design:   { bg: 'rgba(34,197,94,0.06)',   border: 'rgba(34,197,94,0.25)',   label: 'Design' },
  review:   { bg: 'rgba(234,179,8,0.06)',   border: 'rgba(234,179,8,0.25)',   label: 'Review' },
  plan:     { bg: 'rgba(99,102,241,0.06)',  border: 'rgba(99,102,241,0.25)',  label: 'Plan' },
  build:    { bg: 'rgba(139,92,246,0.06)',  border: 'rgba(139,92,246,0.25)',  label: 'Build' },
  validate: { bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.25)', label: 'Validate' },
  qa:       { bg: 'rgba(236,72,153,0.06)',  border: 'rgba(236,72,153,0.25)',  label: 'QA' },
  security: { bg: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.25)',   label: 'Security' },
  ship:     { bg: 'rgba(16,185,129,0.06)',  border: 'rgba(16,185,129,0.25)',  label: 'Ship' },
};

const PHASE_BOX_PADDING = 30;
const PHASE_BOX_TOP_PADDING = 24;

/**
 * Generate phase-box nodes that visually group work nodes by phase.
 * Returns background rectangle nodes with zIndex: -1.
 */
export function generatePhaseBoxes(
  workNodes: Node<CanvasNodeData>[],
): Node<CanvasNodeData>[] {
  // Group nodes by phase
  const groups = new Map<CanvasPhase, Node<CanvasNodeData>[]>();
  for (const node of workNodes) {
    if (node.data.isPhaseBox || node.data.isGhost) continue;
    const phase = node.data.phase ?? inferPhase(node.data.nodeType);
    const list = groups.get(phase) ?? [];
    list.push(node);
    groups.set(phase, list);
  }

  const boxes: Node<CanvasNodeData>[] = [];

  for (const [phase, nodes] of groups) {
    if (nodes.length === 0) continue;

    // Compute bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const size = estimateNodeSize(n.data.nodeType, n.data.content, n.data.items);
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + size.width);
      maxY = Math.max(maxY, n.position.y + size.height);
    }

    const colors = PHASE_COLORS[phase];
    const boxWidth = (maxX - minX) + PHASE_BOX_PADDING * 2;
    const boxHeight = (maxY - minY) + PHASE_BOX_PADDING + PHASE_BOX_TOP_PADDING + PHASE_BOX_PADDING;

    boxes.push({
      id: `phase-box-${phase}`,
      type: 'phase_box',
      position: {
        x: minX - PHASE_BOX_PADDING,
        y: minY - PHASE_BOX_TOP_PADDING - PHASE_BOX_PADDING,
      },
      zIndex: -1,
      selectable: false,
      draggable: false,
      data: {
        nodeType: 'phase_box',
        agentId: '',
        ticketId: '',
        content: colors.label,
        isPhaseBox: true,
        phase,
        boxWidth,
        boxHeight,
        bgColor: colors.bg,
        borderColor: colors.border,
      },
    });
  }

  return boxes;
}

/**
 * Reconstruct LayoutState from existing node positions.
 * Used for backward compatibility with canvases saved before the layout engine.
 */
export function rebuildLayoutState(
  nodes: Array<{ position: { x: number; y: number }; data: { isGhost?: boolean; groupId?: string; nodeType?: string }; type?: string }>,
): LayoutState {
  const layout = createLayoutState();

  for (const node of nodes) {
    if (node.data.isGhost) continue;

    const lane = node.data.groupId ?? DEFAULT_LANE;
    const width = WIDTH_BY_TYPE[node.type as CanvasNodeType] ?? DEFAULT_WIDTH;
    const rightEdge = node.position.x + width + H_GAP;

    if (!(lane in layout.nextX) || rightEdge > layout.nextX[lane]) {
      layout.nextX[lane] = rightEdge;
    }
    if (!(lane in layout.laneY)) {
      layout.laneY[lane] = node.position.y;
      layout.laneOrder.push(lane);
    }
  }

  return layout;
}
