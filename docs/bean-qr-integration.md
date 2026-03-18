# Bean QR Integration for External Inventory Apps

This document explains how another project, such as a smart fridge inventory app, can read BeanLog bean labels and turn them into inventory items.

## What the QR code contains

Each printed bean label QR code contains a URL in this format:

```text
https://<beanlog-app-origin>/label/<label_uid>
```

Example:

```text
https://beanlog.example.com/label/2d6b8e24-4c45-4d2f-a03d-58c2df5d6f64
```

The important part for integration is the final path segment:

- `label_uid`: unique per printed label

Current BeanLog behavior:

- One printed label = one `label_uid`
- Multiple labels can point to the same `bean_uid`
- `grams` is optional and represents the amount printed on that label

## Recommended integration approach

Do not scrape the HTML from `/label/<label_uid>`.

Use the public Supabase RPC instead:

- RPC name: `get_public_bean_by_label_uid`
- Input: `p_label_uid` (`uuid`)
- Access: public read via Supabase `anon` or `authenticated` role

This returns the bean metadata attached to that label in a structured form.

## Public lookup API

Endpoint:

```text
POST https://<supabase-project-ref>.supabase.co/rest/v1/rpc/get_public_bean_by_label_uid
```

Headers:

```http
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_ANON_KEY>
Content-Type: application/json
```

Body:

```json
{
  "p_label_uid": "2d6b8e24-4c45-4d2f-a03d-58c2df5d6f64"
}
```

Notes:

- The response is an array because the RPC returns a table.
- For a valid but unknown label UID, expect an empty array.
- For an invalid UUID string, expect a request error from Supabase/PostgREST.

## Response shape

The RPC returns at most one row with these fields:

| Field | Type | Meaning |
|---|---|---|
| `label_uid` | `uuid` | Unique printed-label identifier |
| `grams` | `number \| null` | Optional starting amount printed on the label |
| `bean_uid` | `uuid` | Stable BeanLog bean record ID |
| `bean_user_uid` | `uuid` | Owner of the bean record |
| `bean_name` | `string \| null` | Bean/display name |
| `roastery` | `string \| null` | Roastery name |
| `producer` | `string \| null` | Producer/farm name |
| `origin_location` | `string \| null` | Region, town, or farm location |
| `origin_country` | `string \| null` | Country |
| `process` | `string \| null` | Processing method |
| `varietal` | `string \| null` | Variety/varietal |
| `roasted_on` | `string \| null` | Roast date in `YYYY-MM-DD` format |
| `cup_flavor_notes` | `FlavorNote[] \| null` | SCA-style flavor notes |
| `created_at` | `string` | Label creation timestamp |

`FlavorNote` currently looks like:

```ts
type FlavorNote = {
  path: string[];
  color: string;
};
```

## Example response

```json
[
  {
    "label_uid": "2d6b8e24-4c45-4d2f-a03d-58c2df5d6f64",
    "grams": 250,
    "bean_uid": "4e0b7874-df3d-4a52-a8c5-2f7ce0f7f4d8",
    "bean_user_uid": "72f6138a-7a53-4f6e-a784-1c50d2ac65cb",
    "bean_name": "Chelbesa",
    "roastery": "BeanLog Roasters",
    "producer": "Danche",
    "origin_location": "Yirgacheffe",
    "origin_country": "Ethiopia",
    "process": "Washed",
    "varietal": "74110, 74112",
    "roasted_on": "2026-03-17",
    "cup_flavor_notes": [
      {
        "path": ["Floral", "Black Tea"],
        "color": "#8b5cf6"
      }
    ],
    "created_at": "2026-03-17T18:42:13.512Z"
  }
]
```

## JavaScript / TypeScript example with `fetch`

```ts
const SUPABASE_URL = process.env.BEANLOG_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.BEANLOG_SUPABASE_ANON_KEY!;

export async function fetchBeanLabel(labelUid: string) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_public_bean_by_label_uid`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_label_uid: labelUid }),
    },
  );

  if (!response.ok) {
    throw new Error(`Bean label lookup failed: ${response.status}`);
  }

  const rows = (await response.json()) as Array<{
    label_uid: string;
    grams: number | null;
    bean_uid: string;
    bean_user_uid: string;
    bean_name: string | null;
    roastery: string | null;
    producer: string | null;
    origin_location: string | null;
    origin_country: string | null;
    process: string | null;
    varietal: string | null;
    roasted_on: string | null;
    cup_flavor_notes: Array<{ path: string[]; color: string }> | null;
    created_at: string;
  }>;

  return rows[0] ?? null;
}
```

## JavaScript / TypeScript example with `@supabase/supabase-js`

```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.BEANLOG_SUPABASE_URL!,
  process.env.BEANLOG_SUPABASE_ANON_KEY!,
);

export async function fetchBeanLabel(labelUid: string) {
  const { data, error } = await supabase.rpc('get_public_bean_by_label_uid', {
    p_label_uid: labelUid,
  });

  if (error) throw error;
  return (data?.[0] as Record<string, unknown> | undefined) ?? null;
}
```

## Extracting `label_uid` from a scanned QR URL

If the smart fridge scanner receives the full QR URL, extract the last path segment and treat it as the label UID.

Example:

```ts
export function parseLabelUidFromQr(qrValue: string): string | null {
  try {
    const url = new URL(qrValue);
    const match = url.pathname.match(/\/label\/([^/?#]+)\/?$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
```

## Inventory modeling recommendations

Recommended identifiers:

- Use `label_uid` as the unique inventory item ID for one physical bag/container.
- Use `bean_uid` as the grouping key for the same bean across multiple printed labels.

Recommended stock behavior:

1. Scan QR code.
2. Extract `label_uid`.
3. Look up the label with `get_public_bean_by_label_uid`.
4. Create or update a smart-fridge inventory item keyed by `label_uid`.
5. Use `grams` as the initial stock amount when present.
6. Track `remaining_grams` inside the smart-fridge project, not in BeanLog.

Suggested local inventory fields:

| Field | Source |
|---|---|
| `external_label_uid` | BeanLog `label_uid` |
| `external_bean_uid` | BeanLog `bean_uid` |
| `display_name` | `bean_name` or roastery + origin fallback |
| `roastery` | RPC response |
| `producer` | RPC response |
| `origin` | `origin_location`, `origin_country` |
| `process` | RPC response |
| `varietal` | RPC response |
| `roasted_on` | RPC response |
| `initial_grams` | `grams` |
| `remaining_grams` | smart-fridge managed |
| `last_scanned_at` | smart-fridge managed |

## Security and privacy notes

Current BeanLog schema intentionally allows public read access to a label by UUID:

- `get_public_bean_by_label_uid` is `security definer`
- execute is granted to `anon` and `authenticated`

This means:

- Another project can read label metadata using the public Supabase URL and anon key.
- The lookup is read-only.
- Anyone who has a valid label QR can resolve the bean metadata exposed by this RPC.

If you store sensitive bean metadata in BeanLog, do not expose it through this function without reviewing the RPC first.

## Contract summary for the smart fridge project

If you only need the minimum contract, use this:

1. Read the QR value.
2. Extract `label_uid` from `/label/<label_uid>`.
3. Call `get_public_bean_by_label_uid`.
4. If a row exists, treat:
   - `label_uid` as the bag/container instance ID
   - `bean_uid` as the shared bean definition ID
   - `grams` as the optional starting inventory amount
5. Store and manage consumption on the smart-fridge side.

## Source of truth in BeanLog

The current implementation lives in these files:

- Web label page: `/Users/leo/coffee_webapp/src/logging/pages/BeanLabelInfoPage.tsx`
- Schema and RPC: `/Users/leo/coffee_webapp/supabase/schema.sql`
- Label generation flow: `/Users/leo/coffee_webapp/src/logging/pages/BeanHistoryPage.tsx`
