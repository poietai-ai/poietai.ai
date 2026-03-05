import { describe, it, expect } from 'vitest';
import {
  createLayoutState,
  estimateNodeSize,
  placeNode,
  placeFanOut,
  placeFanIn,
  rebuildLayoutState,
  inferPhase,
  generatePhaseBoxes,
  PHASE_COLORS,
  H_GAP,
} from './canvasLayout';
import type { CanvasNodeData } from '../types/canvas';
import type { Node } from '@xyflow/react';

describe('createLayoutState', () => {
  it('initializes with default lane at x=0, y=80', () => {
    const layout = createLayoutState();
    expect(layout.nextX['']).toBe(0);
    expect(layout.laneY['']).toBe(80);
    expect(layout.laneOrder).toEqual(['']);
  });
});

describe('estimateNodeSize', () => {
  it('returns width from lookup table', () => {
    expect(estimateNodeSize('thought').width).toBe(384);
    expect(estimateNodeSize('status_update').width).toBe(320);
    expect(estimateNodeSize('fan_out').width).toBe(300);
  });

  it('adjusts height by content length', () => {
    const short = estimateNodeSize('thought', 'hello');
    const long = estimateNodeSize('thought', 'a'.repeat(300));
    expect(long.height).toBeGreaterThan(short.height);
  });

  it('adjusts height by item count', () => {
    const single = estimateNodeSize('file_read', '', ['file.ts']);
    const multi = estimateNodeSize('file_read', '', ['a.ts', 'b.ts', 'c.ts']);
    expect(multi.height).toBeGreaterThan(single.height);
  });

  it('caps height at 400px', () => {
    const huge = estimateNodeSize('thought', 'a'.repeat(5000), Array(50).fill('item'));
    expect(huge.height).toBe(400);
  });
});

describe('placeNode', () => {
  it('places first node at origin of default lane', () => {
    const layout = createLayoutState();
    const pos = placeNode(layout, '', 'thought', 'hi');
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(80);
  });

  it('advances nextX after placement', () => {
    const layout = createLayoutState();
    const pos1 = placeNode(layout, '', 'thought', 'hi');
    expect(layout.nextX['']).toBe(pos1.width + H_GAP);

    const pos2 = placeNode(layout, '', 'file_read', 'read');
    expect(pos2.x).toBe(pos1.width + H_GAP);
  });

  it('places nodes in separate lanes at different Y', () => {
    const layout = createLayoutState();
    layout.nextX['lane-a'] = 500;
    layout.laneY['lane-a'] = 300;
    layout.laneTallest['lane-a'] = 0;
    layout.laneOrder.push('lane-a');

    const pos = placeNode(layout, 'lane-a', 'file_edit', 'edit');
    expect(pos.x).toBe(500);
    expect(pos.y).toBe(300);
  });

  it('falls back to default lane for unknown lane', () => {
    const layout = createLayoutState();
    const pos = placeNode(layout, 'unknown-lane', 'thought', 'hi');
    expect(pos.y).toBe(80); // default lane y
  });

  it('tracks tallest node in lane', () => {
    const layout = createLayoutState();
    placeNode(layout, '', 'thought', 'a'.repeat(200));
    expect(layout.laneTallest['']).toBeGreaterThan(0);
  });
});

describe('placeFanOut', () => {
  it('creates lanes for each group', () => {
    const layout = createLayoutState();
    placeNode(layout, '', 'thought', 'hi');

    const groups = [
      { group_id: 'builder', agent_role: 'builder' },
      { group_id: 'reviewer', agent_role: 'reviewer' },
    ];
    const pos = placeFanOut(layout, groups);

    expect(pos.width).toBe(300);
    expect(layout.nextX['builder']).toBeDefined();
    expect(layout.nextX['reviewer']).toBeDefined();
    expect(layout.laneY['builder']).not.toBe(layout.laneY['reviewer']);
    expect(layout.laneOrder).toContain('builder');
    expect(layout.laneOrder).toContain('reviewer');
  });

  it('positions fan-out at max x across lanes', () => {
    const layout = createLayoutState();
    placeNode(layout, '', 'thought', 'first');
    placeNode(layout, '', 'file_read', 'second');

    const nextXBefore = layout.nextX[''];
    const pos = placeFanOut(layout, [
      { group_id: 'g1', agent_role: 'role' },
    ]);
    expect(pos.x).toBe(nextXBefore);
  });
});

describe('placeFanIn', () => {
  it('merges lanes back to default', () => {
    const layout = createLayoutState();
    const groups = [
      { group_id: 'g1', agent_role: 'builder' },
      { group_id: 'g2', agent_role: 'reviewer' },
    ];
    placeFanOut(layout, groups);

    // Simulate nodes in each lane
    placeNode(layout, 'g1', 'file_edit', 'edit');
    placeNode(layout, 'g2', 'file_read', 'read');

    const pos = placeFanIn(layout, ['g1', 'g2']);
    expect(pos.y).toBe(80); // back to default lane y

    // Lanes should be cleaned up
    expect(layout.nextX['g1']).toBeUndefined();
    expect(layout.nextX['g2']).toBeUndefined();
    expect(layout.laneOrder).not.toContain('g1');
    expect(layout.laneOrder).not.toContain('g2');
  });

  it('positions fan-in at max x of all lanes', () => {
    const layout = createLayoutState();
    placeFanOut(layout, [
      { group_id: 'g1', agent_role: 'builder' },
      { group_id: 'g2', agent_role: 'reviewer' },
    ]);

    placeNode(layout, 'g1', 'file_edit', 'a');
    placeNode(layout, 'g1', 'file_edit', 'b');
    placeNode(layout, 'g1', 'file_edit', 'c');
    placeNode(layout, 'g2', 'file_read', 'x');

    const maxBefore = Math.max(layout.nextX['g1'], layout.nextX['g2'], layout.nextX['']);
    const pos = placeFanIn(layout, ['g1', 'g2']);
    expect(pos.x).toBe(maxBefore);
  });

  it('advances default lane past fan-in', () => {
    const layout = createLayoutState();
    placeFanOut(layout, [{ group_id: 'g1', agent_role: 'builder' }]);
    placeNode(layout, 'g1', 'file_edit', 'edit');

    const pos = placeFanIn(layout, ['g1']);
    expect(layout.nextX['']).toBe(pos.x + pos.width + H_GAP);
  });
});

describe('rebuildLayoutState', () => {
  it('reconstructs nextX from node positions', () => {
    const nodes = [
      { position: { x: 0, y: 80 }, data: {}, type: 'thought' },
      { position: { x: 424, y: 80 }, data: {}, type: 'file_read' },
    ];
    const layout = rebuildLayoutState(nodes);
    // Last node is at x=424, width=384, so nextX should be 424+384+40 = 848
    expect(layout.nextX['']).toBe(424 + 384 + H_GAP);
  });

  it('skips ghost nodes', () => {
    const nodes = [
      { position: { x: 0, y: -180 }, data: { isGhost: true }, type: 'plan_task' },
      { position: { x: 0, y: 80 }, data: {}, type: 'thought' },
    ];
    const layout = rebuildLayoutState(nodes);
    expect(layout.nextX['']).toBe(384 + H_GAP);
  });

  it('rebuilds swim lanes from groupId', () => {
    const nodes = [
      { position: { x: 500, y: 300 }, data: { groupId: 'g1' }, type: 'file_edit' },
      { position: { x: 0, y: 80 }, data: {}, type: 'thought' },
    ];
    const layout = rebuildLayoutState(nodes);
    expect(layout.nextX['g1']).toBe(500 + 384 + H_GAP);
    expect(layout.laneY['g1']).toBe(300);
    expect(layout.laneOrder).toContain('g1');
  });

  it('returns valid layout for empty nodes', () => {
    const layout = rebuildLayoutState([]);
    expect(layout.nextX['']).toBe(0);
    expect(layout.laneY['']).toBe(80);
  });
});

describe('inferPhase', () => {
  it('maps plan_task to plan', () => {
    expect(inferPhase('plan_task')).toBe('plan');
  });

  it('maps fan_out and fan_in to build', () => {
    expect(inferPhase('fan_out')).toBe('build');
    expect(inferPhase('fan_in')).toBe('build');
  });

  it('maps validate_result to validate', () => {
    expect(inferPhase('validate_result')).toBe('validate');
  });

  it('maps qa_result to qa', () => {
    expect(inferPhase('qa_result')).toBe('qa');
  });

  it('maps security_result to security', () => {
    expect(inferPhase('security_result')).toBe('security');
  });

  it('maps review_synthesis to ship', () => {
    expect(inferPhase('review_synthesis')).toBe('ship');
  });

  it('defaults to build for generic node types', () => {
    expect(inferPhase('thought')).toBe('build');
    expect(inferPhase('file_read')).toBe('build');
    expect(inferPhase('file_edit')).toBe('build');
    expect(inferPhase('bash_command')).toBe('build');
    expect(inferPhase('agent_message')).toBe('build');
  });
});

describe('generatePhaseBoxes', () => {
  function makeNode(overrides: Partial<Node<CanvasNodeData>> & { id: string }): Node<CanvasNodeData> {
    return {
      position: { x: 0, y: 80 },
      type: 'thought',
      data: {
        nodeType: 'thought',
        agentId: 'a1',
        ticketId: 't1',
        content: 'hello',
        phase: 'build',
      },
      ...overrides,
    };
  }

  it('returns empty array for no nodes', () => {
    expect(generatePhaseBoxes([])).toEqual([]);
  });

  it('creates one box per phase group', () => {
    const nodes = [
      makeNode({ id: 'n1', position: { x: 0, y: 80 }, data: { nodeType: 'thought', agentId: '', ticketId: '', content: 'a', phase: 'build' } }),
      makeNode({ id: 'n2', position: { x: 400, y: 80 }, data: { nodeType: 'file_edit', agentId: '', ticketId: '', content: 'b', phase: 'build' } }),
      makeNode({ id: 'n3', position: { x: 900, y: 80 }, data: { nodeType: 'validate_result', agentId: '', ticketId: '', content: 'c', phase: 'validate' } }),
    ];
    const boxes = generatePhaseBoxes(nodes);
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.data.phase).sort()).toEqual(['build', 'validate']);
  });

  it('boxes have correct metadata', () => {
    const nodes = [
      makeNode({ id: 'n1', position: { x: 100, y: 80 }, data: { nodeType: 'thought', agentId: '', ticketId: '', content: 'hi', phase: 'build' } }),
    ];
    const boxes = generatePhaseBoxes(nodes);
    expect(boxes).toHaveLength(1);
    const box = boxes[0];
    expect(box.type).toBe('phase_box');
    expect(box.data.isPhaseBox).toBe(true);
    expect(box.zIndex).toBe(-1);
    expect(box.selectable).toBe(false);
    expect(box.draggable).toBe(false);
    expect(box.data.bgColor).toBe(PHASE_COLORS.build.bg);
    expect(box.data.borderColor).toBe(PHASE_COLORS.build.border);
    expect(box.data.content).toBe('Build');
  });

  it('skips ghost nodes', () => {
    const nodes = [
      makeNode({ id: 'n1', data: { nodeType: 'plan_task', agentId: '', ticketId: '', content: 'ghost', isGhost: true, phase: 'plan' } }),
    ];
    const boxes = generatePhaseBoxes(nodes);
    expect(boxes).toHaveLength(0);
  });

  it('skips existing phase box nodes', () => {
    const nodes = [
      makeNode({ id: 'pb1', data: { nodeType: 'phase_box', agentId: '', ticketId: '', content: 'Build', isPhaseBox: true, phase: 'build' } }),
    ];
    const boxes = generatePhaseBoxes(nodes);
    expect(boxes).toHaveLength(0);
  });

  it('uses inferPhase when phase is not set', () => {
    const nodes = [
      makeNode({ id: 'n1', position: { x: 0, y: 80 }, data: { nodeType: 'validate_result', agentId: '', ticketId: '', content: '' } }),
    ];
    const boxes = generatePhaseBoxes(nodes);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].data.phase).toBe('validate');
  });

  it('box position encloses all nodes with padding', () => {
    const nodes = [
      makeNode({ id: 'n1', position: { x: 100, y: 200 }, data: { nodeType: 'thought', agentId: '', ticketId: '', content: 'a', phase: 'build' } }),
      makeNode({ id: 'n2', position: { x: 500, y: 200 }, data: { nodeType: 'thought', agentId: '', ticketId: '', content: 'b', phase: 'build' } }),
    ];
    const boxes = generatePhaseBoxes(nodes);
    const box = boxes[0];
    // Box should start before the leftmost node
    expect(box.position.x).toBeLessThan(100);
    expect(box.position.y).toBeLessThan(200);
    // Box dimensions should be positive and larger than the node span
    expect(box.data.boxWidth!).toBeGreaterThan(500 - 100);
    expect(box.data.boxHeight!).toBeGreaterThan(0);
  });
});
