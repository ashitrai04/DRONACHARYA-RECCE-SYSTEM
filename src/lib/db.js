import { supabase } from './supabase';

const NOT_CONFIGURED_ERROR = 'Supabase is not configured yet.';

export async function saveMission(missionData) {
  if (!supabase) return { data: null, error: NOT_CONFIGURED_ERROR };
  try {
    const { data, error } = await supabase
      .from('missions')
      .insert([missionData])
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('Failed to save mission:', err);
    return { data: null, error: err.message };
  }
}

export async function loadMissions() {
  if (!supabase) return { data: null, error: NOT_CONFIGURED_ERROR };
  try {
    const { data, error } = await supabase
      .from('missions')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('Failed to load missions:', err);
    return { data: null, error: err.message };
  }
}

export async function saveReport(reportData) {
  if (!supabase) return { data: null, error: NOT_CONFIGURED_ERROR };
  try {
    const { data, error } = await supabase
      .from('reports')
      .insert([reportData])
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('Failed to save report:', err);
    return { data: null, error: err.message };
  }
}

export async function saveDroneRecceMission(droneData) {
  if (!supabase) return { data: null, error: NOT_CONFIGURED_ERROR };
  try {
    const { data, error } = await supabase
      .from('drone_missions')
      .insert([droneData])
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('Failed to save drone recce mission:', err);
    return { data: null, error: err.message };
  }
}

export async function saveBatteryAllocation(allocationData) {
  if (!supabase) return { data: null, error: NOT_CONFIGURED_ERROR };
  try {
    // If we want to upsert by mission_id + battery_number, we can use upsert. 
    // For now, just insert.
    const { data, error } = await supabase
      .from('battery_allocations')
      .insert([allocationData])
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('Failed to save battery allocation:', err);
    return { data: null, error: err.message };
  }
}
