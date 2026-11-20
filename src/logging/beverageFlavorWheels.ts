import type { I18nKey } from '../i18n/i18n';
import { SCA_FLAVOR_WHEEL, type FlavorWheelNode } from './scaFlavorWheel';
import type { BeverageType } from './types';

const tea: FlavorWheelNode[] = [
  { name: "Vegetal", color: '#50803b', children: [{ name: "Grass" }, { name: "Seaweed" }, { name: "Steamed Greens" }] },
  { name: "Floral", color: '#a65376', children: [{ name: "Orchid" }, { name: "Jasmine" }, { name: "Rose" }] },
  { name: "Fruity", color: '#b45309', children: [{ name: "Peach" }, { name: "Citrus" }, { name: "Dried Plum" }] },
  { name: "Roasted", color: '#885533', children: [{ name: "Roasted Nuts" }, { name: "Toast" }, { name: "Smoke" }] },
  { name: "Earthy", color: '#695040', children: [{ name: "Forest Floor" }, { name: "Wood" }, { name: "Mushroom" }] },
  { name: "Sweet", color: '#a26c19', children: [{ name: "Honey" }, { name: "Malt" }, { name: "Caramel" }] },
  { name: "Mouthfeel", color: '#42668a', children: [{ name: "Umami" }, { name: "Astringent" }, { name: "Silky" }, { name: "Bitter" }] },
];

const wine: FlavorWheelNode[] = [
  { name: "Fruit", color: '#a44c54', children: [{ name: "Citrus" }, { name: "Green Apple" }, { name: "Stone Fruit" }, { name: "Red Berries" }, { name: "Black Fruit" }, { name: "Dried Fruit" }] },
  { name: "Floral", color: '#a65376', children: [{ name: "Violet" }, { name: "Rose" }, { name: "Blossom" }] },
  { name: "Herbal & Spice", color: '#50803b', children: [{ name: "Green Pepper" }, { name: "Mint" }, { name: "Black Pepper" }, { name: "Clove" }] },
  { name: "Oak & Aging", color: '#885533', children: [{ name: "Vanilla" }, { name: "Cedar" }, { name: "Tobacco" }, { name: "Leather" }] },
  { name: "Fermentation", color: '#a26c19', children: [{ name: "Brioche" }, { name: "Butter" }, { name: "Yeast" }] },
  { name: "Earthy & Mineral", color: '#64717c', children: [{ name: "Wet Stone" }, { name: "Earth" }, { name: "Mushroom" }] },
];

export const beverageFlavorWheels = { coffee: SCA_FLAVOR_WHEEL, tea, wine };

const names = new Set([...tea, ...wine].flatMap(node => [node.name, ...node.children!.map(child => child.name)]));

export function beverageFlavorLabel(name: string, type: BeverageType, t: (key: I18nKey) => string): string {
  return type !== 'coffee' && names.has(name) ? t(`beverage.flavor.${name}` as I18nKey) : name;
}
