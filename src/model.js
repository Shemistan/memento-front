// Модель дерева: только данные, без отрисовки.
// Узел: { id, name, parentId, born }; корень — ствол (parentId = null).

export const ROOT_ID = 'root';

export function createTree(rootName = 'Ствол') {
  return { seq: 0, nodes: [{ id: ROOT_ID, name: rootName, parentId: null, born: 0 }] };
}

export function getNode(tree, id) {
  return tree.nodes.find((n) => n.id === id) || null;
}

export function childrenOf(tree, id) {
  return tree.nodes.filter((n) => n.parentId === id);
}

export function addBranch(tree, parentId, name, born = 0) {
  if (!getNode(tree, parentId)) throw new Error(`Нет ветки ${parentId}`);
  const clean = String(name ?? '').trim();
  tree.seq += 1;
  const node = { id: `b${tree.seq}`, name: clean || `Ветка ${tree.seq}`, parentId, born };
  tree.nodes.push(node);
  return node;
}

export function renameBranch(tree, id, name) {
  const node = getNode(tree, id);
  const clean = String(name ?? '').trim();
  if (node && clean) node.name = clean;
  return node;
}

// Удаляет ветку вместе со всеми потомками. Ствол удалить нельзя.
export function removeBranch(tree, id) {
  if (id === ROOT_ID || !getNode(tree, id)) return [];
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of tree.nodes) {
      if (!doomed.has(n.id) && doomed.has(n.parentId)) {
        doomed.add(n.id);
        grew = true;
      }
    }
  }
  tree.nodes = tree.nodes.filter((n) => !doomed.has(n.id));
  return [...doomed];
}

export function depthOf(tree, id) {
  let depth = 0;
  let node = getNode(tree, id);
  while (node && node.parentId) {
    depth += 1;
    node = getNode(tree, node.parentId);
  }
  return depth;
}

// Текстовый формат: одна строка — одна ветка, вложенность — отступом.
// Первая строка без отступа — ствол; остальные строки — его потомки.
export function parseOutline(text, born = 0) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\t/g, '  '))
    .filter((raw) => raw.trim() && !raw.trim().startsWith('#'));
  if (!lines.length) throw new Error('Пустая структура');

  const indentOf = (raw) => raw.length - raw.trimStart().length;
  const clean = (raw) => raw.trim().replace(/^[-*•]\s*/, '');
  const tree = createTree(clean(lines[0]));
  const rootIndent = indentOf(lines[0]);
  const stack = [{ indent: rootIndent, id: ROOT_ID }];

  for (const raw of lines.slice(1)) {
    const indent = Math.max(indentOf(raw), rootIndent + 1);
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const node = addBranch(tree, stack[stack.length - 1].id, clean(raw), born);
    stack.push({ indent, id: node.id });
  }
  return tree;
}

export function toOutline(tree) {
  const lines = [];
  const walk = (id, depth) => {
    lines.push(`${'  '.repeat(depth)}${getNode(tree, id).name}`);
    for (const child of childrenOf(tree, id)) walk(child.id, depth + 1);
  };
  walk(ROOT_ID, 0);
  return lines.join('\n');
}

export function serialize(tree) {
  return JSON.stringify(tree);
}

export function deserialize(json) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.nodes) || !data.nodes.some((n) => n.id === ROOT_ID)) {
    throw new Error('Некорректные данные дерева');
  }
  // Оставляем только узлы, достижимые от ствола: сироты и циклы отбрасываются.
  const reachable = new Set([ROOT_ID]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of data.nodes) {
      if (!reachable.has(n.id) && reachable.has(n.parentId)) {
        reachable.add(n.id);
        grew = true;
      }
    }
  }
  const nodes = data.nodes
    .filter((n) => reachable.has(n.id))
    .map((n) => ({ id: String(n.id), name: String(n.name), parentId: n.id === ROOT_ID ? null : n.parentId, born: Number(n.born) || 0 }));
  const maxId = Math.max(0, ...nodes.map((n) => Number(n.id.slice(1)) || 0));
  return { seq: Math.max(Number(data.seq) || 0, maxId), nodes };
}
