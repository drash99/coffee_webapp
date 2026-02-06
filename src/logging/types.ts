export type BeanInput = {
  bean_name: string;
  roastery: string;
  producer: string;
  origin_location: string; // town/farm/region
  origin_country: string;
  process: string;
  varietal: string;
  cup_notes: string;
  cup_flavor_notes: FlavorNote[];
  roasted_on: string; // YYYY-MM-DD
};

export type GrinderInput = {
  maker: string;
  model: string;
  setting: string;
};

export type FlavorNote = {
  path: string[]; // e.g. ["Fruity", "Berry", "Strawberry"]
  color: string; // hex
};

export type BrewInput = {
  brew_date: string; // YYYY-MM-DD
  recipe: string;
  coffee_dose_g: string;
  coffee_yield_g: string;
  coffee_tds: string; // empty => N/A
  water: string;
  water_temp: string; // empty => N/A (saved as C in DB)
  grind_median_um: string; // empty => N/A
  rating: number; // 0..5 step 0.5
  extraction_note: string;
  taste_note: string;
  taste_flavor_notes: FlavorNote[];
};

export type BeanRow = {
  uid: string;
  user_uid: string;
  bean_name: string | null;
  roastery: string | null;
  producer: string | null;
  origin_location: string | null;
  origin_country: string | null;
  process: string | null;
  varietal: string | null;
  cup_notes: string | null;
  cup_flavor_notes: FlavorNote[] | null;
  roasted_on: string | null;
  created_at?: string;
};

export type GrinderRow = {
  uid: string;
  user_uid: string;
  maker: string | null;
  model: string | null;
  created_at?: string;
};

export type BrewRow = {
  uid: string;
  user_uid: string;
  brew_date: string;
  bean_uid: string;
  grinder_uid: string | null;
  grinder_setting: string | null;
  recipe: string | null;
  coffee_dose_g: number | null;
  coffee_yield_g: number | null;
  coffee_tds: number | null;
  water: string | null;
  water_temp_c: number | null;
  grind_median_um: number | null;
  rating: number | null;
  extraction_note: string | null;
  taste_note: string | null;
  taste_flavor_notes: FlavorNote[] | null;
  created_at?: string;
};

export type GrinderParticleSizeRow = {
  uid: string;
  user_uid: string;
  grinder_uid: string;
  grinder_setting: string;
  particle_median_um: number;
  created_at?: string;
};


