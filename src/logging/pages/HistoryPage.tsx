import { useEffect, useMemo, useState } from 'react';
import type { AppUser } from '../../auth/types';
import { getSupabaseClient } from '../../config/supabase';
import type { BeanRow, BrewRow, FlavorNote, GrinderRow } from '../types';

type Props = {
  user: AppUser;
};

type BrewWithBean = BrewRow & {
  beans: Pick<BeanRow, 'uid' | 'bean_name' | 'roastery' | 'producer' | 'origin' | 'process' | 'varietal' | 'roasted_on'> | null;
  grinders: Pick<GrinderRow, 'uid' | 'maker' | 'model' | 'setting'> | null;
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function fmtNoteList(notes: FlavorNote[] | null | undefined): string {
  if (!notes || notes.length === 0) return '—';
  return notes.map((n) => n.path.join(' / ')).join(', ');
}

export function HistoryPage({ user }: Props) {
  const [rows, setRows] = useState<BrewWithBean[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const selected = useMemo(() => rows.find((r) => r.uid === selectedUid) ?? null, [rows, selectedUid]);

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase
        .from('brews')
        .select(
          `
          uid,
          user_uid,
          brew_date,
          bean_uid,
          recipe,
          coffee_dose_g,
          coffee_yield_g,
          coffee_tds,
          water,
          water_temp_c,
          grinder_uid,
          extraction_note,
          taste_note,
          cup_flavor_notes,
          taste_flavor_notes,
          created_at,
          beans ( uid, bean_name, roastery, producer, origin, process, varietal, roasted_on ),
          grinders ( uid, maker, model, setting )
        `
        )
        .eq('user_uid', user.uid)
        .order('brew_date', { ascending: false });
      if (err) throw new Error(err.message);
      setRows((data ?? []) as BrewWithBean[]);
      if ((data ?? []).length > 0 && !selectedUid) setSelectedUid((data ?? [])[0]?.uid ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Brew history</h2>
        <button
          type="button"
          className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:bg-gray-100"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700">Your brews</div>
          {rows.length === 0 && !loading ? (
            <div className="p-4 text-sm text-gray-500">No brews yet. Save your first brew to see it here.</div>
          ) : (
            <div className="divide-y">
              {rows.map((r) => {
                const beanLabel = r.beans?.bean_name || r.beans?.roastery || r.beans?.origin || 'Bean';
                const active = r.uid === selectedUid;
                return (
                  <button
                    key={r.uid}
                    type="button"
                    onClick={() => setSelectedUid(r.uid)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                      active ? 'bg-amber-50' : 'bg-white'
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">
                      {fmtDate(r.brew_date)} — {beanLabel}
                    </div>
                    <div className="text-xs text-gray-500">
                      dose {r.coffee_dose_g ?? '—'}g · yield {r.coffee_yield_g ?? '—'}g · tds {r.coffee_tds ?? 'N/A'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-4 py-3 border-b bg-gray-50 text-sm font-medium text-gray-700">Details</div>
          {!selected ? (
            <div className="p-4 text-sm text-gray-500">Select a brew from the list.</div>
          ) : (
            <div className="p-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500">Date</div>
                  <div className="font-medium text-gray-900">{fmtDate(selected.brew_date)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Bean</div>
                  <div className="font-medium text-gray-900">
                    {selected.beans?.bean_name || '—'}{' '}
                    {selected.beans?.roastery ? `— ${selected.beans.roastery}` : ''}{' '}
                    {selected.beans?.origin ? `(${selected.beans.origin})` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Grinder</div>
                  <div className="font-medium text-gray-900">
                    {selected.grinders?.maker || '—'}
                    {selected.grinders?.model ? ` ${selected.grinders.model}` : ''}
                    {selected.grinders?.setting ? ` — ${selected.grinders.setting}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Dose / Yield</div>
                  <div className="font-medium text-gray-900">
                    {selected.coffee_dose_g ?? '—'}g / {selected.coffee_yield_g ?? '—'}g
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">TDS</div>
                  <div className="font-medium text-gray-900">{selected.coffee_tds ?? 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Water</div>
                  <div className="font-medium text-gray-900">{selected.water ?? '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Water temp</div>
                  <div className="font-medium text-gray-900">{selected.water_temp_c == null ? 'N/A' : `${selected.water_temp_c}°C`}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500">Recipe</div>
                <div className="whitespace-pre-wrap text-gray-900">{selected.recipe || '—'}</div>
              </div>

              <div>
                <div className="text-xs text-gray-500">Cup notes (SCA)</div>
                <div className="text-gray-900">{fmtNoteList(selected.cup_flavor_notes)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Taste notes (SCA)</div>
                <div className="text-gray-900">{fmtNoteList(selected.taste_flavor_notes)}</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500">Extraction note</div>
                  <div className="whitespace-pre-wrap text-gray-900">{selected.extraction_note || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Taste note (free text)</div>
                  <div className="whitespace-pre-wrap text-gray-900">{selected.taste_note || '—'}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


