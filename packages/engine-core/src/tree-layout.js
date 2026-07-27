/* ============================================================
   tree-layout.js — CURRICULUM T2: the TREE ability. Pure 2D layout for hierarchies.
   ------------------------------------------------------------
   This is the capability the whole data-structures track needs. A binary search tree is the first
   consumer; a heap, a trie, an expression tree and a DOM-ish hierarchy are the same shape with different
   labels. So the layout knows nothing about BSTs — it takes "a node with children" and returns positions.

   THE ALGORITHM, and why this one. The naive layout ("x = my in-order index, y = my depth") never
   overlaps, but it puts a parent wherever its in-order position happens to fall, so the picture leans and
   the eye cannot follow a parent down to its children. The classic cure is Reingold–Tilford; the honest
   observation is that its full contour-threading machinery buys you nothing for the trees a LESSON shows.
   So this is the two-pass simplification that gives the same result on well-formed trees:

     1. LEAVES get consecutive x slots, left to right. Two leaves can never collide (distinct slots).
     2. AN INTERNAL NODE sits at the MEAN of its children's x. Its subtree occupies exactly the leaf slots
        beneath it, and sibling subtrees own disjoint leaf ranges — so a parent always lands strictly
        inside its own span, and two subtrees can never overlap. The guarantee is structural, not tuned.

   Depth is y. Deterministic: same tree in, same coordinates out, every time (a lesson whose diagram
   reshuffles on reload is teaching you that the picture is arbitrary — it isn't).

   C++ anchor: `struct Node { int key; Node* left; Node* right; };` — the layout is a post-order fold over
   exactly that structure. Post-order matters: you cannot place a parent until you know where its children
   went, which is the same reason you free a tree bottom-up.
   ============================================================ */

/* childrenOf(node) — the default accessor: {left, right} for binary trees, or an explicit children[].
   A consumer with a different shape passes its own. */
const defaultChildren = (n) => {
  if (!n) return [];
  if (Array.isArray(n.children)) return n.children.filter(Boolean);
  return [n.left, n.right].filter((c) => c != null);
};

/* treeLayout(root, opts) → { positions: Map<node, {x, y, depth}>, width, height, depth, order }
     opts.childrenOf : (node) => node[]        — the shape accessor
     opts.gapX       : horizontal slot width   (default 1)
     opts.gapY       : vertical layer height   (default 1)
   Positions are in ABSTRACT units (slots and layers); the renderer scales them to pixels. Keeping the
   layout unit-free is what lets the same numbers drive an SVG panel, a canvas, or a WebGL field. */
export function treeLayout(root, { childrenOf = defaultChildren, gapX = 1, gapY = 1 } = {}) {
  const positions = new Map();
  const order = [];              // in-order-ish visit order (left → self → right), the reading order
  if (!root) return { positions, width: 0, height: 0, depth: 0, order };

  let nextLeafSlot = 0;
  let maxDepth = 0;

  /* One post-order pass. Recursion depth is the tree's depth — fine for lesson-sized trees, and the
     honest shape of the algorithm. (A production layout over a 10⁶-node tree would want an explicit
     stack; saying so is cheaper than pretending this is that.) */
  const place = (node, depth) => {
    if (!node) return 0;
    maxDepth = Math.max(maxDepth, depth);
    const kids = childrenOf(node);

    if (kids.length === 0) {
      const x = nextLeafSlot++;
      positions.set(node, { x: x * gapX, y: depth * gapY, depth });
      order.push(node);
      return x;
    }

    /* Left children first, then this node, then the right ones — so `order` comes out in READING order
       (which for a BST is sorted order, and that is a fact worth being able to see in the panel). */
    const xs = [];
    const mid = Math.ceil(kids.length / 2);
    for (let i = 0; i < mid; i++) xs.push(place(kids[i], depth + 1));
    const selfIndex = order.length;
    for (let i = mid; i < kids.length; i++) xs.push(place(kids[i], depth + 1));

    const x = xs.reduce((a, b) => a + b, 0) / xs.length;   // centred over the children it actually has
    positions.set(node, { x: x * gapX, y: depth * gapY, depth });
    order.splice(selfIndex, 0, node);
    return x;
  };

  place(root, 0);
  const width = Math.max(nextLeafSlot - 1, 0) * gapX;
  return { positions, width, height: maxDepth * gapY, depth: maxDepth, order };
}

/* treeEdges(root, childrenOf) → [[parent, child], …] — the links a renderer draws. Separate from the
   layout because a consumer may want the edges without the coordinates (a test, a text dump). */
export function treeEdges(root, childrenOf = defaultChildren) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    for (const c of childrenOf(n)) { out.push([n, c]); walk(c); }
  };
  walk(root);
  return out;
}

/* treeDepth(root) → the number of LAYERS below the root (a single node has depth 0).
   This is the number the whole data-structures track is really about: a search costs one comparison per
   layer, so the depth IS the complexity. A balanced tree has depth ⌊log₂ n⌋; a degenerate one has n−1,
   and that difference is the entire lesson. */
export function treeDepth(root, childrenOf = defaultChildren) {
  if (!root) return -1;
  const kids = childrenOf(root);
  if (!kids.length) return 0;
  return 1 + Math.max(...kids.map((c) => treeDepth(c, childrenOf)));
}
