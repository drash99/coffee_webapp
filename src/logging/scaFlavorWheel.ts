export type FlavorWheelNode = {
  name: string;
  color?: string; // used for dot color (usually top-level)
  children?: FlavorWheelNode[];
};

// Note: This is a structured subset of the SCA flavor wheel taxonomy, organized for cascading dropdowns.
// It’s intentionally modular so we can reuse it for both “cup notes” and “taste notes”, and expand it later.
export const SCA_FLAVOR_WHEEL: FlavorWheelNode[] = [
  {
    name: 'Fruity',
    color: '#f97316',
    children: [
      { name: 'Berry', children: [{ name: 'Strawberry' }, { name: 'Raspberry' }, { name: 'Blueberry' }, { name: 'Blackberry' }] },
      { name: 'Dried Fruit', children: [{ name: 'Raisin' }, { name: 'Prune' }, { name: 'Date' }] },
      { name: 'Citrus Fruit', children: [{ name: 'Grapefruit' }, { name: 'Orange' }, { name: 'Lemon' }, { name: 'Lime' }] },
      { name: 'Stone Fruit', children: [{ name: 'Peach' }, { name: 'Apricot' }, { name: 'Nectarine' }, { name: 'Cherry' }] },
      { name: 'Tropical Fruit', children: [{ name: 'Pineapple' }, { name: 'Mango' }, { name: 'Papaya' }, { name: 'Coconut' }] },
      { name: 'Pome Fruit', children: [{ name: 'Apple' }, { name: 'Pear' }] }
    ]
  },
  {
    name: 'Floral',
    color: '#ec4899',
    children: [{ name: 'Jasmine' }, { name: 'Rose' }, { name: 'Lavender' }, { name: 'Hibiscus' }]
  },
  {
    name: 'Sweet',
    color: '#f59e0b',
    children: [
      { name: 'Vanilla' },
      { name: 'Honey' },
      { name: 'Brown Sugar', children: [{ name: 'Molasses' }, { name: 'Maple Syrup' }, { name: 'Caramel' }] }
    ]
  },
  {
    name: 'Nutty/Cocoa',
    color: '#a16207',
    children: [
      { name: 'Nutty', children: [{ name: 'Almond' }, { name: 'Hazelnut' }, { name: 'Peanut' }, { name: 'Walnut' }] },
      { name: 'Cocoa', children: [{ name: 'Dark Chocolate' }, { name: 'Milk Chocolate' }, { name: 'Cacao Nib' }] }
    ]
  },
  {
    name: 'Spices',
    color: '#b45309',
    children: [{ name: 'Cinnamon' }, { name: 'Clove' }, { name: 'Nutmeg' }, { name: 'Pepper' }, { name: 'Anise' }]
  },
  {
    name: 'Roasted',
    color: '#92400e',
    children: [{ name: 'Toast' }, { name: 'Smoky' }, { name: 'Burnt' }, { name: 'Tobacco' }]
  },
  {
    name: 'Green/Vegetative',
    color: '#22c55e',
    children: [
      { name: 'Fresh', children: [{ name: 'Peapod' }, { name: 'Green Beans' }, { name: 'Grassy' }, { name: 'Herbal' }] },
      { name: 'Vegetative', children: [{ name: 'Bell Pepper' }, { name: 'Tomato' }] }
    ]
  },
  {
    name: 'Sour/Fermented',
    color: '#ef4444',
    children: [
      { name: 'Sour', children: [{ name: 'Sour' }, { name: 'Tart' }] },
      { name: 'Fermented', children: [{ name: 'Winey' }, { name: 'Overripe' }, { name: 'Alcoholic' }] }
    ]
  },
  {
    name: 'Other',
    color: '#6b7280',
    children: [
      { name: 'Earthy' },
      { name: 'Musty' },
      { name: 'Papery' },
      { name: 'Chemical' },
      { name: 'Bitter' }
    ]
  }
];

export const NA_NOTE = { path: ['N/A'], color: '#9ca3af' } as const;

export function getNodeByPath(path: string[]): FlavorWheelNode | null {
  if (path.length === 0) return null;
  let nodes = SCA_FLAVOR_WHEEL;
  let current: FlavorWheelNode | undefined;
  for (let i = 0; i < path.length; i++) {
    current = nodes.find((n) => n.name === path[i]);
    if (!current) return null;
    nodes = current.children ?? [];
  }
  return current ?? null;
}

export function getTopLevelColor(topLevel: string): string {
  if (topLevel === 'N/A') return NA_NOTE.color;
  const node = SCA_FLAVOR_WHEEL.find((n) => n.name === topLevel);
  return node?.color ?? '#6b7280';
}


